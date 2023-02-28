/**
 * Copyright (c) Appblocks. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const { default: axios } = require('axios')
const chalk = require('chalk')
const { spinnies } = require('../loader')
const { appBlockUpdateAppConfig } = require('../utils/api')
const { appConfig } = require('../utils/appconfigStore')
const { feedback } = require('../utils/cli-feedback')
const { getShieldHeader } = require('../utils/getHeaders')
const { getBlockDetails } = require('../utils/registryUtils')

const push_config = async () => {
  await appConfig.init()
  if (appConfig.isInBlockContext && !appConfig.isInAppblockContext) {
    feedback({ type: 'error', message: 'Not an appblock' })
    process.exit(1)
  }
  const name = appConfig.getName()

  spinnies.add('pushConfig', { text: `Getting details of ${name}` })

  // TODO - write a utility function wrapping getBlockDetails, should be able to call getBlockID
  const ID = await getBlockDetails(name)
    .then((res) => {
      if (res.status === 204) {
        spinnies.fail('pushConfig', { text: `${name} not found in registry.` })
        process.exit(1)
      }
      if (res.data.err) {
        spinnies.fail('pushConfig', { text: `Error getting details from registry.` })
        process.exit(1)
      }
      // Make sure it is registered as package, else unregistered
      if (res.data.data.BlockType !== 1) {
        spinnies.fail('pushConfig', { text: `${name} is not registered as appblock` })
        process.exit(1)
      }
      // eslint-disable-next-line no-param-reassign
      return res.data.data.ID
    })
    .catch((err) => {
      spinnies.fail('pushConfig', { text: `Something went terribly wrong...` })
      console.log(err)
      process.exit(1)
    })

  spinnies.update('pushConfig', { text: 'Preparing config to upload' })
  const data = {
    block_id: ID,
    app_config: appConfig.getAppConfig(),
  }
  spinnies.update('pushConfig', { text: 'Pushing..' })
  try {
    await axios.post(appBlockUpdateAppConfig, { ...data }, { headers: getShieldHeader() })
    spinnies.succeed('pushConfig', { text: 'Appconfig pushed!' })
  } catch (err) {
    spinnies.fail('pushConfig', { text: 'Failed!' })
    console.log(chalk.dim(err.message))
    console.log(chalk.red(`Couldn't upload ..try again later`))
  }
  spinnies.remove('pushConfig')
}

module.exports = push_config
