import {ethers} from 'https://unpkg.com/ethers/dist/ethers.esm.js'

const URL = 'https://ethereum-goerli-rpc.allthatnode.com'

const p = ethers.getDefaultProvider(URL)

const latest = await p.getBlock()

const txs = await Promise.all(latest.transactions.map(t => 
  p.getTransactionReceipt(t)
))

const totalGas = txs.reduce((gas,tx) => 
  gas.add(tx.gasUsed), ethers.BigNumber.from(0))
