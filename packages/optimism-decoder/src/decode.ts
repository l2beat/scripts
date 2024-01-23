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
import { decode } from 'punycode'
import { parse } from 'path'
import { mnemonicToEntropy } from 'ethers/lib/utils'
import { exit } from 'process'

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
/*

//4d73adb72bc3dd368966edd0f0b2148401a178e2

86 038465ab8606
86 04840122a208
b9 0b77 0003000000000000027404f9027083597a5d8407270e00835ca96d94a0cc33dd6f4819d473226257792afe230ec3c67f80b902046c459a28
000000000000000000000000
4d73adb72bc3dd368966edd0f0b2148401a178e2
00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000065abda65
*/

/* 	L1MessageType_L2Message             = 3
	L1MessageType_EndOfBlock            = 6
	L1MessageType_L2FundedByL1          = 7
	L1MessageType_RollupEvent           = 8
	L1MessageType_SubmitRetryable       = 9
	L1MessageType_BatchForGasEstimation = 10 // probably won't use this in practice
	L1MessageType_Initialize            = 11
	L1MessageType_EthDeposit            = 12
	L1MessageType_BatchPostingReport    = 13
	L1MessageType_Invalid               = 0xFF
  /* 

/* 
ARBITRUM SEGMENT TYPES:

const BatchSegmentKindL2Message uint8 = 0
const BatchSegmentKindL2MessageBrotli uint8 = 1
const BatchSegmentKindDelayedMessages uint8 = 2
const BatchSegmentKindAdvanceTimestamp uint8 = 3
const BatchSegmentKindAdvanceL1BlockNumber uint8 = 4
*/

/* 	L2MessageKind_UnsignedUserTx  = 0
	L2MessageKind_ContractTx      = 1
	L2MessageKind_NonmutatingCall = 2
	L2MessageKind_Batch           = 3
	L2MessageKind_SignedTx        = 4
	// 5 is reserved
	L2MessageKind_Heartbeat          = 6 // deprecated
	L2MessageKind_SignedCompressedTx = 7
	// 8 is reserved for BLS signed batch
) */

export function decodeArbitrumL2Message(
  tx: string,
  fourBytesApi: FourBytesApi,
) {
  const type = tx.slice(0, 2)
  //console.log('  Type:', type)
  const rawTx = add0x(tx.slice(2))
  const parsed = ethers.utils.parseTransaction(rawTx)
  const methodHash = parsed.data.slice(0, 10)
  // const methodSignature = await fourBytesApi.getMethodSignature(methodHash)
  const methodSignature = '???'
  //console.log(
  //  '  ',
  //  trimLong(tx),
  //  methodHash,
  //  methodSignature,
  //  parsed.from,
  //  parsed.to,
  // )
  //console.log(parsed.from, parsed.to)
}

export function decodeArbitrumL2MessageBatch(
  l2Message: string,
  fourBytesApi: FourBytesApi,
) {
  //console.log('decoding L2Message:')
  //console.log(l2Message)
  //console.log()
  let totalRead = 0
  for (let i = 0; ; i++) {
    const length = parseInt(l2Message.slice(totalRead, totalRead + 16), 16) * 2
    //console.log('  TxChunkLength:', i, +length)
    const tx = l2Message.slice(totalRead + 16, totalRead + 16 + length)
    //console.log(tx, tx.length)
    //decodeArbitrumL2Message(tx, fourBytesApi)
    totalRead += length + 16
    //console.log('TotalRead: ', totalRead)
    if (totalRead >= l2Message.length) break
  }
}

export function decodeArbitrumSegment(
  segment: string,
  fourBytesApi: FourBytesApi,
): string {
  const segmentContentType = segment.slice(0, 2)
  let timestamp = '0x00'
  //console.log('SegmentContentType: ', segmentContentType)
  switch (segmentContentType) {
    case '00': // Batch of signed transactions
      if (segment.slice(2, 4) === '03') {
        decodeArbitrumL2MessageBatch(segment.slice(4), fourBytesApi)
      } else {
        const tx = segment.slice(4)
        decodeArbitrumL2Message(add0x(tx), fourBytesApi)
      }
      break
    case '03': // AdvanceTimestamp + 4 bytes
      timestamp = ethers.utils.RLP.decode(add0x(segment.slice(2)))
      //console.log('  AdvanceTimestamp:', timestamp, parseInt(timestamp, 16))
      break
    case '04': // AdvanceL1BlockNumber + 4 bytes
      const l1block = ethers.utils.RLP.decode(add0x(segment.slice(2)))
      //console.log('  AdvanceL1BlockNumber:', l1block, parseInt(l1block, 16))
      break
    default:
      console.log(
        'Unknown segment type',
        segmentContentType,
        segment.slice(4),
        parseInt(segment.slice(4), 16),
      )
  }
  return timestamp
}

export function decodeArbitrumBatch(
  kind: string,
  data: string,
  submissionTimestamp: number,
  fourBytesApi: FourBytesApi,
) {
  let minTimestamp, maxTimestamp
  let firstTimestamp = true

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
      //TODO: No idea what are the correct params.
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
        [zlib.constants.BROTLI_PARAM_QUALITY]:
          zlib.constants.BROTLI_MAX_QUALITY,
      },
    })
    //console.log('Decompressed data:', decompressedData)
    let reader = new BufferReader(decompressedData)

    const decompressedBytes = reader.readBytes(reader.left())
    const totalLength = decompressedBytes.toString('hex').length / 2 // we do /2 because we are counting bytes
    const lengthBytes = ethers.utils.hexlify(totalLength).slice(2)
    const lengthBytesLength = lengthBytes.length / 2
    const lengthByte = 0xf7 + lengthBytesLength
    const lengthByteHex = ethers.utils.hexlify(lengthByte)
    const concatenatedWithLength =
      lengthByteHex +
      lengthBytes +
      (decompressedBytes.toString('hex') as string)
    const decoded = ethers.utils.RLP.decode(concatenatedWithLength)
    console.log('Decoded:', decoded.length)
    for (const [index, value] of decoded.entries()) {
      const timestamp = decodeArbitrumSegment(value.slice(2), fourBytesApi)
      if (firstTimestamp) {
        minTimestamp = parseInt(timestamp, 16)
        maxTimestamp = parseInt(timestamp, 16)
        firstTimestamp = false
      } else {
        maxTimestamp += parseInt(timestamp, 16)
      }
    }
    console.log('Submission timestamp:', submissionTimestamp)
    console.log('Min L2 timestamp in submission:', minTimestamp)
    console.log('Max L2 timestamp in submission:', maxTimestamp)
    const minT = submissionTimestamp - minTimestamp
    const maxT = submissionTimestamp - maxTimestamp
    console.log(
      'Finality delay between',
      minT,
      'and',
      maxT,
      'seconds (',
      parseFloat((minT / 60).toFixed(2)),
      'and',
      parseFloat((maxT / 60).toFixed(2)),
      'minutes)',
    )
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

  // ----- reading decompressed data ----- This is RLP list w/out the header, so we need to add header

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
