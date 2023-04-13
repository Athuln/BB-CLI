/* eslint-disable */
const { spinnies } = require('../../loader')
const { Logger } = require('../../utils/loggerV2')
const CreateCore = require('./createCore')
const handleBeforeCreate = require('./plugins/handleBeforeCreate')
const handleFunctions = require('./plugins/handleFunction')
const HandleOutOfContext = require('./plugins/handleOutOfContext')
const handleSharedFunction = require('./plugins/handleSharedFunction')
const handleUIContainer = require('./plugins/handleUIContainer')
const handleUIDependency = require('./plugins/handleUIDependency')
const handleUIElement = require('./plugins/handleUIElement')

async function create(blockName, cmdOptions) {
  const { logger } = new Logger('create')
  const Create = new CreateCore(blockName, cmdOptions, { logger, spinnies })

  console.log('create v2 temp up')

  try {
    new HandleOutOfContext().apply(Create)
    new handleBeforeCreate().apply(Create)
    new handleFunctions().apply(Create)
    new handleSharedFunction().apply(Create)
    new handleUIElement().apply(Create)
    new handleUIContainer().apply(Create)
    new handleUIContainer().apply(Create)
    new handleUIDependency().apply(Create)

    await Create.initializeAppConfig()
    await Create.createBlock()
  } catch (error) {
    console.log(error)
    logger.error(error)
    spinnies.stopAll()
  }
}

module.exports = create
