import { assert } from '@l2beat/backend-tools'
import { EthereumAddress, Hash256 } from '@l2beat/types'
import { providers, utils } from 'ethers'

import { getRelevantBlobs } from './getRelevantBlobs'

const SEQUENCER_INBOX = EthereumAddress(
  '0x6c97864CE4bEf387dE0b3310A44230f7E3F1be0D',
)

const RPC_URL = 'https://1rpc.io/sepolia'
const provider = new providers.JsonRpcProvider(RPC_URL)

/**
 *    event SequencerBatchDelivered(
 *      uint256 indexed batchSequenceNumber,
 *      bytes32 indexed beforeAcc,
 *      bytes32 indexed afterAcc,
 *      bytes32 delayedAcc,
 *      uint256 afterDelayedMessagesRead,
 *      IBridge.TimeBounds timeBounds,
 *      IBridge.BatchDataLocation dataLocation
 *    );
 *
 *   enum BatchDataLocation {
 *      /// @notice The data can be found in the transaction call data
 *      TxInput,
 *      /// @notice The data can be found in an event emitted during the transaction
 *      SeparateBatchEvent,
 *      /// @notice This batch contains no data
 *      NoData,
 *      /// @notice The data can be found in the 4844 data blobs on this transaction
 *      Blob
 *  }
 *
 */

const abi = [
  'event SequencerBatchDelivered(uint256 indexed batchSequenceNumber, bytes32 indexed beforeAcc, bytes32 indexed afterAcc, bytes32 delayedAcc, uint256 afterDelayedMessagesRead, tuple(uint64 minTimestamp, uint64 maxTimestamp, uint64 minBlockNumber, uint64 maxBlockNumber) timeBounds, uint8 dataLocation)',
]
const int = new utils.Interface(abi)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const tx = await getLatestBlobTx()
  console.log('latest blob transaction:', tx)
  // const tx = {
  //   hash: Hash256(
  //     '0xcd7ebeaaf884936ce7ae5309e518fe18dee7b8ab1fac3581a038b3325812341e',
  //   ),
  //   blockNumber: 5427689,
  // }

  const relevantBlobs = await getRelevantBlobs(tx)
  console.log(
    'relevant blobs:',
    relevantBlobs.map((b) => b.versionedHash),
  )
}

async function getLatestBlobTx() {
  const blockNumber = await provider.getBlockNumber()

  console.log('blockNumber', blockNumber)

  const logs = await provider.getLogs({
    address: SEQUENCER_INBOX.toString(),
    fromBlock: blockNumber - 1000,
    toBlock: blockNumber,
    topics: [int.getEventTopic('SequencerBatchDelivered')],
  })

  const txs = logs
    .filter((log) => int.parseLog(log).args.dataLocation === 3)
    .map((log) => ({
      hash: Hash256(log.transactionHash),
      blockNumber: log.blockNumber,
    }))

  const latestTx = txs[0]

  assert(latestTx, 'No latest tx found')

  return latestTx
}
