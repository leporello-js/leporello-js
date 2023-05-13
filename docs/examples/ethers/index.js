//import {ethers} from 'https://unpkg.com/ethers/dist/ethers.js'
import {ethers} from 'https://unpkg.com/ethers@5.7.2/dist/ethers.esm.js'

const URL = 'https://ethereum-goerli-rpc.allthatnode.com'

const p = ethers.getDefaultProvider(URL)
await p._networkPromise


const latest = await p.getBlock()
latest


const txs = await Promise.all(latest.transactions.map(t => 
  p.getTransactionReceipt(t)
))


const totalGas = txs.reduce((gas,tx) => 
  gas.add(tx.gasUsed), ethers.BigNumber.from(0))
  
  
  
  
  totalGas.add(21)
  

/*
const totalGas = txs.reduce((gas,tx) => 
  gas + tx.gasUsed, BigInt(0))
  
  totalGas + 1
*/

  
  
  

  

  
