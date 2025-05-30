import { ethers } from "ethers"

const URL = "https://eth-mainnet.public.blastapi.io"

const p = ethers.getDefaultProvider(URL)

const latest = await p.getBlock()

const txs = await Promise.all(
  latest.transactions.map(t => p.getTransactionReceipt(t)),
)

const totalGas = txs
  .filter(tx => tx != null)
  .reduce((gas, tx) => gas.add(tx.gasUsed), ethers.BigNumber.from(0))
