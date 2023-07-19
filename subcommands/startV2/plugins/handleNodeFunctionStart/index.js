/* eslint-disable no-param-reassign */
/* eslint-disable class-methods-use-this */
const path = require('path')
const { spawn, execSync } = require('child_process')
const { openSync, existsSync } = require('fs')
const { writeFile } = require('fs/promises')
const { spinnies } = require('../../../../loader')
const { pexec } = require('../../../../utils/execPromise')
const { generateEmFolder } = require('./generateEmulator')
const { updateEmulatorPackageSingleBuild, linkEmulatedNodeModulesToBlocks } = require('./mergeData')
const { getNodePackageInstaller } = require('../../../../utils/nodePackageManager')
const { headLessConfigStore } = require('../../../../configstore')
const { upsertEnv, readEnvAsObject } = require('../../../../utils/envManager')
const { readJsonAsync } = require('../../../../utils')
const {
  getBBFolderPath,
  BB_FOLDERS,
  generateOutLogPath,
  BB_FILES,
  generateErrLogPath,
} = require('../../../../utils/bbFolders')

class HandleNodeFunctionStart {
  constructor() {
    this.fnBlocks = []
    this.fnSharedBlocks = []
    this.blockEmulateData = {}
    this.middlewareBlockListData = {}
    this.depsInstallReport = []
    this.port = 5000
    this.pid = 0
  }

  /**
   *
   * @param {} StartCore
   */
  apply(StartCore) {
    StartCore.hooks.beforeStart.tapPromise('HandleNodeFunctionStart', async (/** @type {StartCore} */ core) => {
      if (core.cmdOpts.blockType && core.cmdOpts.blockType !== 'function') return

      /**
       * Filter node fn blocks
       */
      for (const { type, blocks } of core.blockStartGroups) {
        if (type === 'function') {
          this.fnBlocks = blocks.filter((b) => b.config.language === 'nodejs')
        } else if (type === 'shared-fn') {
          this.fnSharedBlocks = blocks.filter((b) => b.config.language === 'nodejs')
        }
      }

      if (!this.fnBlocks.length) return

      const emPath = getBBFolderPath(BB_FOLDERS.FUNCTIONS_EMULATOR, core.cwd)

      const { installer } = getNodePackageInstaller()
      const { FUNCTIONS_LOG } = BB_FILES
      const logOutPath = generateOutLogPath(FUNCTIONS_LOG, core.cwd)
      const logErrPath = generateErrLogPath(FUNCTIONS_LOG, core.cwd)

      spinnies.add('emBuild', { text: 'Building function emulator' })
      this.fnBlocks.forEach((block) => {
        const dir = path.relative(path.resolve(), block.directory)
        this.blockEmulateData[dir] = {
          name: block.config.name,
          type: block.config.type,
          directory: block.directory,
          middlewares: block.config.middlewares,
          relativeDirectory: dir,
        }
      })

      core.middlewareBlockList.forEach((block) => {
        const dir = path.relative(path.resolve(), block.directory)
        this.middlewareBlockListData[block.config.name] = {
          name: block.config.name,
          type: block.config.type,
          directory: block.directory,
          relativeDirectory: dir,
        }
      })

      /**
       * Get ports
       */
      this.port = this.fnBlocks[0].availablePort

   

      if (core.cmdOpts.singleInstance) {
        const sharedBlocks = {}
        this.fnSharedBlocks.forEach((b) => {
          sharedBlocks[b.config.name] = {
            ...b.config,
            directory: b.directory,
          }
        })
        await updateEmulatorPackageSingleBuild(emPath, { ...this.blockEmulateData, ...sharedBlocks })
      }

      spinnies.update('emBuild', { text: 'Installing dependencies for function emulator' })
      const res = await pexec(installer, { cwd: emPath })
      if (res.err) {
        spinnies.fail('emBuild', { text: 'Installing dependencies failed for function emulator' })
        throw new Error(res.err)
      }

      if (core.cmdOpts.singleInstance) {
        spinnies.update('emBuild', { text: 'Configuring node modules' })
        await linkEmulatedNodeModulesToBlocks(emPath, this.blockEmulateData)
        if (this.fnSharedBlocks?.length) {
          await linkEmulatedNodeModulesToBlocks(
            emPath,
            this.fnSharedBlocks.map((m) => ({ directory: m.directory }))
          )
        }
      } else {
        spinnies.update('emBuild', { text: 'Installing dependencies in function blocks' })
        const pArray = []
        this.fnBlocks.forEach((_v) => {
          pArray.push(pexec(installer, { cwd: _v.directory }, _v))
        })
        /**
         * @type {PromiseFulfilledResult<{err:boolean,data:object}>}
         */
        this.depsInstallReport = await Promise.allSettled(pArray)
      }

      const { environment } = core.cmdOpts
      const headlessConfig = headLessConfigStore().store
      const currentPackEnvPrefix = core.packageConfig.name.toUpperCase()
      const envPrefixes = [currentPackEnvPrefix]
      const subPackageNames = []
      for (const { packageManager } of core.subPackages) {
        subPackageNames.push(packageManager.config.name)
      }

      if (headlessConfig.prismaSchemaFolderPath) {
        const ie = await pexec('npx prisma generate', { cwd: headlessConfig.prismaSchemaFolderPath })
        if (ie.err) throw new Error(ie.err)

        const envPath = path.join(path.resolve(), `.env.function${environment ? `.${environment}` : ''}`)
        const existEnvData = await readEnvAsObject(envPath)

        const subPackagePrefix = subPackageNames.find((s) => headlessConfig.prismaSchemaFolderPath.includes(s))
        let dbEnv = existEnvData[`BB_${currentPackEnvPrefix}_DATABASE_URL`]
        if (subPackagePrefix) dbEnv = existEnvData[`BB_${subPackagePrefix.toUpperCase()}_DATABASE_URL`]

        if (dbEnv) execSync(`export BB_${currentPackEnvPrefix}_DATABASE_URL=${dbEnv}`)
      }

      spinnies.update('emBuild', { text: 'Starting emulator' })

      try {
        // Release port before server start
        this.fnBlocks[0]?.portKey.abort()

        // handle environments
        const updateEnvValue = { [`BB_${currentPackEnvPrefix}_FUNCTION_URL`]: `http://localhost:${this.port}` }

        for (const { packageManager } of core.subPackages) {
          const pEnvPrefix = packageManager.config.name.toUpperCase()
          const relativePath = path.relative(path.resolve(), packageManager.directory)
          updateEnvValue[`BB_${pEnvPrefix}_FUNCTION_URL`] = `http://localhost:${this.port}/${relativePath}`
          envPrefixes.push(pEnvPrefix)
        }

        const updatedFnEnv = await upsertEnv('function', {}, environment, envPrefixes)
        const updatedViewEnv = await upsertEnv('view', updateEnvValue, environment, envPrefixes)
        core.envWarning.keys = core.envWarning.keys
          .concat(updatedFnEnv.envWarning.keys)
          .concat(updatedViewEnv.envWarning.keys)
        core.envWarning.prefixes = core.envWarning.prefixes
          .concat(updatedFnEnv.envWarning.prefixes)
          .concat(updatedViewEnv.envWarning.prefixes)

          const swaggerEnable=updatedFnEnv.envObject[`BB_${currentPackEnvPrefix}_SWAGGER_ENABLE`]??false

          const _emFolderGen = await generateEmFolder(
            emPath,
            this.blockEmulateData,
            this.port,
            this.middlewareBlockListData,
            swaggerEnable
          )
          if (_emFolderGen.err) {
            spinnies.fail('emBuild', { text: 'Function emulator build failed' })
            return
          }

        let child = { pid: 0 }
        let pm2InstanceName
        if (core.cmdOpts.pm2) {
          try {
            execSync('pm2 -v', { stdio: 'ignore' })
          } catch {
            throw new Error('Please install pm2 and try again')
          }

          const command = 'pm2'
          pm2InstanceName = process.env.BB_PM2_NAME || core.cmdArgs.blockName || core.packageConfig.name
          let args = ['start', 'index.js', '-i', 'max', '--name', pm2InstanceName]

          if (existsSync('pm2.json')) {
            const { data, err } = await readJsonAsync('pm2.json')
            if (err) throw err
            pm2InstanceName = data.apps?.[0]?.name || pm2InstanceName
            args = ['start', path.join(emPath, '..', 'pm2.json'), '-f']
          }

          execSync(`${command} ${args.join(' ')}`, {
            cwd: emPath,
            stdio: ['ignore', openSync(logOutPath, 'w'), openSync(logErrPath, 'w')],
            env: { ...process.env, parentPath: core.cwd },
          })
        } else {
          // start node
          child = spawn('node', ['index.js'], {
            cwd: emPath,
            detached: true,
            stdio: ['ignore', openSync(logOutPath, 'w'), openSync(logErrPath, 'w')],
            env: { ...process.env, parentPath: core.cwd },
          })
          child.unref()
          this.pid = child.pid
        }
        await writeFile(path.join(emPath, '.emconfig.json'), `{"pid":${child.pid}}`)

        const updateConfig = {
          isOn: true,
          singleInstance: true,
          pid: this.pid || null,
          port: this.port || null,
          pm2InstanceName,
          log: { out: logOutPath, err: logErrPath },
        }

        for (const blockManager of this.fnBlocks) {
          const relativePath = path.relative(path.resolve(), blockManager.directory)
          updateConfig.liveUrl = `localhost:${this.port}/${relativePath || path.basename(blockManager.directory)}`
          blockManager.updateLiveConfig(updateConfig)
        }

        // update middleware block as live to avoid issues of some blocks are not start
        for (const blockManager of core.middlewareBlockList) {
          const relativePath = path.relative(path.resolve(), blockManager.directory)
          updateConfig.liveUrl = `localhost:${this.port}/${relativePath || path.basename(blockManager.directory)}`
          blockManager.updateLiveConfig(updateConfig)
        }

        // update middleware block as live to avoid issues of some blocks are not start
        for (const { type, blocks } of core.blockStartGroups) {
          if (type !== 'shared-fn') continue
          for (const blockManager of blocks) {
            blockManager.updateLiveConfig(updateConfig)
          }
        }

        spinnies.succeed('emBuild', { text: `Function emulator started at http://localhost:${this.port}` })
      } catch (err) {
        console.log(err)
        spinnies.fail('emBuild', { text: `Failed to start emulator: ${err.message}` })
        return
      }

      const tsBlocks = []
      for (const _v of this.depsInstallReport) {
        if (existsSync(path.join(path.resolve(_v.value.data.directory), 'index.ts'))) {
          tsBlocks.push(path.resolve(_v.value.data.directory))
        }

        // console.log(`✓ installed deps in ${this.fnBlocks[i].name}`)
        console.log(`✗ error installing deps in ${_v.value.data.config.name}`)
        /**
         * TODO: write a proper plugin for typescript
         */
        const watcher = spawn('node', ['tsWatcher.js', ...tsBlocks], {
          detached: true,
          cwd: path.join(__dirname),
          stdio: ['ignore', openSync(logOutPath, 'w'), openSync(logErrPath, 'w')],
        })
        await writeFile(path.join(emPath, '.emconfig.json'), `{"pid":${this.pid},"watcherPid":${watcher.pid}}`)

        watcher.unref()
      }
    })
  }
}

module.exports = HandleNodeFunctionStart
