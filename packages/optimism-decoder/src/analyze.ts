import { providers } from 'ethers'

const ctcMapping: Record<string, string | undefined> = {
  '0x5E4e65926BA27467555EB562121fac00D24E9dD2': 'Optimism OVM 2.0',
  '0x4BF681894abEc828B212C906082B444Ceb2f6cf6': 'Optimism OVM 1.0',
  '0x56a76bcC92361f6DF8D75476feD8843EdC70e1C9': 'Metis',
  '0x6A1DB7d799FBA381F2a518cA859ED30cB8E1d41a': 'Metis 2.0',
  '0xfBd2541e316948B259264c02f370eD088E04c3Db': 'Boba Network',
  '0x5f7f7f6DB967F0ef10BdA0678964DBA185d16c50': 'Lyra',
  '0xFf00000000000000000000000000000000008453': 'Base',
  '0x6F54Ca6F6EdE96662024Ffd61BFd18f3f4e34DFf': 'Zora',
  '0xC1B90E1e459aBBDcEc4DCF90dA45ba077d83BFc5': 'PGN',
  '0xFF00000000000000000000000000000000000010': 'OPMainnet',
  '0x253887577420Cb7e7418cD4d50147743c8041b28': 'Aevo'
}

const typeMapping: Record<string, string | undefined> = {
  Lyra: 'OpStack',
  Base: 'OpStack',
  Zora: 'OpStack',
  PGN: 'OpStack',
  OPMainnet: 'OpStack',
  Aevo: 'OpStack',
  'Boba Network': 'OVM 2.0',
  'Optimism OVM 1.0': 'OVM 1.0',
}

export async function analyzeTransaction(
  provider: providers.Provider,
  txHash: string,
) {
  const tx = await provider.getTransaction(txHash)
  const block = await provider.getBlock(tx.blockNumber)
  const project = ctcMapping[tx.to ?? ''] ?? 'Unknown'
  const kind = typeMapping[project ?? ''] ?? 'Unknown'
  console.log(
    'Tx submits data to',
    tx.to,
    'hence it is',
    project,
    'of kind',
    kind,
  )

  return {
    data: tx.data,
    timestamp: block.timestamp,
    project,
    kind,
  }
}
