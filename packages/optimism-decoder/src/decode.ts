/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import assert from 'assert'
import { BufferReader } from 'bufio'
import { ethers } from 'ethers'
import zlib from 'zlib'

import { FourBytesApi } from './FourBytesApi'
import { add0x, trimLong } from './utils'

interface BatchContext {
  sequencerTxCount: number
  queueTxCount: number
  timestamp: number
  blockNumber: number
}

interface AppendSequencerBatchParams {
  shouldStartAtElement: number // 5 bytes -- starts at batch
  totalElementsToAppend: number // 3 bytes -- total_elements_to_append
  contexts: BatchContext[] // total_elements[fixed_size[]]
  transactions: string[] // total_size_bytes[], total_size_bytes[]
}

export async function decodeArbitrumBatch(
  kind: string,
  data: string,
  fourBytesApi: FourBytesApi,
) {
  console.log('Decoding Arbitrum...')
  const abi = [
    'function addSequencerL2BatchFromOrigin(uint256 sequenceNumber,bytes data,uint256 afterDelayedMessagesRead,address gasRefunder,uint256 prevMessageCount,uint256 newMessageCount)',
  ]
  const iface = new ethers.utils.Interface(abi)
  const decodedArgs = iface.decodeFunctionData(data.slice(0, 10), data)
  console.log(decodedArgs.data.slice(2, 4)) // removing 0x, next byte is type of compressed data
  let brotliCompressedData = Buffer.from(decodedArgs.data.slice(4), 'hex')
  try {
    let decompressedData = zlib.brotliDecompressSync(brotliCompressedData, {
      //TODO: No idea what are the correct params
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]:
          zlib.constants.BROTLI_MAX_QUALITY,
      },
    })
    console.log('Decompressed data:', decompressedData.toString())
  } catch (err) {
    console.error('An error occurred:', err)
  }
}

export async function decodeOpStackSequencerBatch(
  kind: string,
  data: string,
  submissionTimestamp: number,
  fourBytesApi: FourBytesApi,
) {
  console.log('Decoding', kind, 'L1 Sequencer transaction batch ...')
  let reader = new BufferReader(Buffer.from(data.slice(2), 'hex'))

  const version = reader.readBytes(1).toString('hex')
  console.log('Version:', version)
  const channelId = reader.readBytes(16).toString('hex')
  console.log('ChannelId:', channelId)
  const frame_number = reader.readU16BE()
  console.log('Frame Number:', frame_number)
  if (frame_number !== 0) {
    console.log(
      "This is not a first frame, I won't be able to decompress this, exiting...",
    )
    return
  }
  const frame_data_length = reader.readU32BE()
  console.log('Frame Data Length:', frame_data_length)
  // console.log(reader.left())
  const bytes = reader.readBytes(frame_data_length)
  const is_last = reader.readBytes(1).toString('hex')
  assert(is_last === '01' || is_last === '00')
  console.log('Is Last:', is_last === '01')
  if (is_last === '00') {
    console.log(
      "This is not a last frame, I won't be able to decompress this, exiting...",
    )
    return
  }

  const inflated = zlib.inflateSync(bytes)

  // ----- reading decompressed data -----

  reader = new BufferReader(inflated)
  const decompressedBytes = reader.readBytes(reader.left())
  const totalLength = decompressedBytes.toString('hex').length / 2 // we do /2 because we are counting bytes
  const lengthBytes = ethers.utils.hexlify(totalLength).slice(2)
  const lengthBytesLength = lengthBytes.length / 2
  const lengthByte = 0xf7 + lengthBytesLength
  const lengthByteHex = ethers.utils.hexlify(lengthByte)
  const concatenatedWithLength =
    lengthByteHex + lengthBytes + (decompressedBytes.toString('hex') as string)
  const decoded = ethers.utils.RLP.decode(concatenatedWithLength)

  let numEmptyBatches = 0
  console.log('Decoding', decoded.length, 'batches')

  const timestamps = []
  for (const [index, batch] of decoded.entries()) {
    // batch: batch_version ++ rlp (parent_hash, epoch_number, epoch_hash, timestamp, transaction_list)
    const decodedBatch = ethers.utils.RLP.decode(add0x(batch.slice(4)))
    const numTxs = decodedBatch[decodedBatch.length - 1].length
    if (numTxs !== 0) {
      // transaction list is not empty
      console.log()
      console.log('Batch #', index, 'with', numTxs, 'transactions')
      console.log('ParentHash', decodedBatch[0])
      console.log('EpochNumber', parseInt(decodedBatch[1], 16))
      console.log('EpochHash', decodedBatch[2])
      const timestamp = parseInt(decodedBatch[3], 16)
      console.log('Timestamp', timestamp)
      timestamps.push(timestamp)

      for (const tx of decodedBatch[decodedBatch.length - 1]) {
        //console.log('tx:', tx)
        const parsed = ethers.utils.parseTransaction(tx)
        const methodHash = parsed.data.slice(0, 10)
        const methodSignature = await fourBytesApi.getMethodSignature(
          methodHash,
        )
        console.log('  ', trimLong(tx), methodHash, methodSignature)
      }
    } else numEmptyBatches++
  }
  console.log('Num of empty batches', numEmptyBatches)
  console.log(
    'Finality delay between',
    submissionTimestamp - Math.min(...timestamps),
    'and',
    submissionTimestamp - Math.max(...timestamps),
    'seconds',
  )
}

export async function decodeSequencerBatch(
  kind: string,
  data: string,
  fourBytesApi: FourBytesApi,
): Promise<AppendSequencerBatchParams | undefined> {
  console.log('Decoding', kind, 'L1 Sequencer transaction batch ...')
  let reader = new BufferReader(Buffer.from(data.slice(2), 'hex'))

  const methodName = reader.readBytes(4).toString('hex')
  console.log('MethodName:', methodName)

  if (kind === 'Metis' || kind === 'Metis 2.0') {
    const chainId = reader.readBytes(32).toString('hex')
    console.log('ChainId:', chainId)
  }
  const shouldStartAtElement = reader.readU40BE()
  const totalElementsToAppend = reader.readU24BE()
  const contextCount = reader.readU24BE()

  console.log('Should start at Element:', shouldStartAtElement)
  console.log('Total Elements to Append:', totalElementsToAppend)
  console.log('contextCount:', contextCount)

  const contexts = []
  for (let i = 0; i < contextCount; i++) {
    const sequencerTxCount = reader.readU24BE()
    const queueTxCount = reader.readU24BE()
    const timestamp = reader.readU40BE()
    const blockNumber = reader.readU40BE()
    contexts.push({
      sequencerTxCount,
      queueTxCount,
      timestamp,
      blockNumber,
    })
    console.log(sequencerTxCount, queueTxCount, timestamp, blockNumber)
  }

  if (contexts[0].blockNumber === 0 && kind === 'Optimism OVM 2.0') {
    console.log(
      'Block number = 0 ? Transactions are compressed, nice.... Decompressing....',
    )
    contexts.slice(1) // remove dummy context that indicates compressed transaction data
    const bytes = reader.readBytes(reader.left())
    const inflated = zlib.inflateSync(bytes)
    reader = new BufferReader(inflated)
  }

  const transactions = []
  for (const context of contexts) {
    console.log('Block:', context.blockNumber, 'Timestamp:', context.timestamp)
    for (let i = 0; i < context.sequencerTxCount; i++) {
      const size = reader.readU24BE()
      const raw = reader.readBytes(size).toString('hex')
      const parsed = ethers.utils.parseTransaction(add0x(raw))
      const methodHash = parsed.data.slice(0, 10)
      const methodSignature = await fourBytesApi.getMethodSignature(methodHash)
      transactions.push(add0x(raw))
      console.log('  ', trimLong(add0x(raw)), methodHash, methodSignature)
    }

    console.log('Decoded', transactions.length, 'transactions')
    console.log('Done decoding...')

    return {
      shouldStartAtElement,
      totalElementsToAppend,
      contexts,
      transactions,
    }
  }
}
