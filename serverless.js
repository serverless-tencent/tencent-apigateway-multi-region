const { Component } = require('@serverless/core')
const random = require('ext/string/random')

// Create a new component by extending the Component Class
class TencentSCFMultiRegion extends Component {
  mergeJson(sourceJson, targetJson) {
    for (const eveKey in sourceJson) {
      if (targetJson.hasOwnProperty(eveKey)) {
        if (['protocols', 'endpoints', 'customDomain'].indexOf(eveKey) != -1) {
          for (let i = 0; i < sourceJson[eveKey].length; i++) {
            const sourceEvents = JSON.stringify(sourceJson[eveKey][i])
            const targetEvents = JSON.stringify(targetJson[eveKey])
            if (targetEvents.indexOf(sourceEvents) == -1) {
              targetJson[eveKey].push(sourceJson[eveKey][i])
            }
          }
        } else {
          if (typeof sourceJson[eveKey] != 'string') {
            this.mergeJson(sourceJson[eveKey], targetJson[eveKey])
          } else {
            targetJson[eveKey] = sourceJson[eveKey]
          }
        }
      } else {
        targetJson[eveKey] = sourceJson[eveKey]
      }
    }
    return targetJson
  }

  async default(inputs = {}) {
    const regionList = typeof inputs.region == 'string' ? [inputs.region] : inputs.region
    const baseInputs = {}
    const apigateways = []
    const apigatewaysOutput = {}
    for (const eveKey in inputs) {
      if (eveKey != 'region' && eveKey.indexOf('ap-') != 0) {
        baseInputs[eveKey] = inputs[eveKey]
      }
    }

    if (inputs.serviceId && regionList.length > 1) {
      throw new Error(
        'For multi region deployment, please specify serviceid under the corresponding region'
      )
    }

    for (let i = 0; i < regionList.length; i++) {
      this.context.status(`Deploying ${regionList[i]} apigateway`)
      let tempInputs = JSON.parse(JSON.stringify(baseInputs)) // clone
      tempInputs.region = regionList[i]
      tempInputs.fromClientRemark = tempInputs.fromClientRemark || 'tencent-apigateway-multi-region'
      if (inputs[regionList[i]]) {
        tempInputs = this.mergeJson(inputs[regionList[i]], tempInputs)
      }
      const tempKey = `${tempInputs.region}-${random({ length: 6 })}`
      apigateways.push(tempKey)
      const tencentApigateway = await this.load('@serverless/tencent-apigateway', tempKey)
      const tencentApigatewayOutput = await tencentApigateway(tempInputs)
      const tempApis = new Array()
      for (let api = 0; api < tencentApigatewayOutput.apis.length; api++) {
        tempApis.push(
          `Method: ${tencentApigatewayOutput.apis[api].method}\t PATH: ${tencentApigatewayOutput.apis[api].path}`
        )
      }
      apigatewaysOutput[tempInputs.region] = {
        serviceId: tencentApigatewayOutput.serviceId,
        subDomain: tencentApigatewayOutput.subDomain,
        environment: tencentApigatewayOutput.environment,
        protocols: tencentApigatewayOutput.protocols,
        apis: tempApis
      }
      apigateways[tempInputs.region] = tencentApigatewayOutput
      this.context.status(`Deployed ${regionList[i]} apigateway`)
    }

    this.state = apigateways
    await this.save()

    return apigatewaysOutput
  }

  async remove(inputs = {}) {
    const removeInput = {
      fromClientRemark: inputs.fromClientRemark || 'tencent-apigateway-multi-region'
    }

    for (let i = 0; i < this.state.length; i++) {
      this.context.status(`Removing ${this.state[i]} apigateway`)
      const tencentApigateway = await this.load('@serverless/tencent-apigateway', this.state[i])
      await tencentApigateway.remove(removeInput)
      this.context.status(`Removed ${this.state[i]} apigateway`)
    }

    // after removal we clear the state to keep it in sync with the service API
    // this way if the user tried to deploy again, there would be nothing to remove
    this.state = {}
    await this.save()

    // might be helpful to output the Bucket that was removed
    return {}
  }
}

// don't forget to export the new Componnet you created!
module.exports = TencentSCFMultiRegion
