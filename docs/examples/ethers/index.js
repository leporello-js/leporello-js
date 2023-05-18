import {ethers} from 'https://unpkg.com/ethers@5.7.2/dist/ethers.esm.js'

const URL = 'https://rpc.ankr.com/eth_goerli'

const p = ethers.getDefaultProvider(URL)

const latest = await p.getBlock()

const txs = await Promise.all(latest.transactions.map(t => 
  p.getTransactionReceipt(t)
))

const totalGas = txs
  .filter(tx => tx != null)
  .reduce((gas,tx) => gas.add(tx.gasUsed), ethers.BigNumber.from(0))
