import {ethers} from 'https://unpkg.com/ethers@5.7.2/dist/ethers.esm.js'

const URL = 'https://rpc.ankr.com/eth'

const provider = await ethers.getDefaultProvider(URL)

const latest = await provider.getBlock('latest')

async function getBlockNumberByTimestamp(timestamp, low = 0, high = latest.number) {
  if(low + 1 == high) {
    return low
  } else {
    const mid = Math.floor((low + high) / 2)
    const midBlock = await provider.getBlock(mid)
    if(midBlock.timestamp > timestamp) {
      return getBlockNumberByTimestamp(timestamp, low, mid)
    } else {
      return getBlockNumberByTimestamp(timestamp, mid, high)
    }
  }
}

const timestamp = new Date('2010-08-03').getTime()/1000
const blockNumber = await getBlockNumberByTimestamp(timestamp)
const block = await provider.getBlock(blockNumber)
