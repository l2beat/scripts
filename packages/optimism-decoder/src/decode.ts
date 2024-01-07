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

export async function decodeOpStackSequencerBatch(
  kind: string,
  data: string,
  fourBytesApi: FourBytesApi,
) {
  console.log('Decoding', kind, 'L1 Sequencer transaction batch ...')
  let reader = new BufferReader(Buffer.from(data.slice(2), 'hex'))

  if (kind === 'Lyra') {
    const version = reader.readBytes(1).toString('hex')
    console.log('Version:', version)
    const channelId = reader.readBytes(16).toString('hex')
    console.log('ChannelId:', channelId)
    const frame_number = reader.readU16BE()
    console.log('Frame Number:', frame_number)
    const frame_data_length = reader.readU32BE()
    console.log('Frame Data Length:', frame_data_length)
    // console.log(reader.left())
    const bytes = reader.readBytes(frame_data_length)
    const is_last = reader.readBytes(1).toString('hex')
    assert(is_last === '01' || is_last === '00')
    console.log('Is Last:', is_last === '01')
    const inflated = zlib.inflateSync(bytes)

    // ----- reading decompressed data -----

    reader = new BufferReader(inflated)
    const decompressedBytes = reader.readBytes(reader.left())
    // console.log(add0x(decompressedBytes.toString('hex')))

    const totalLength = decompressedBytes.toString('hex').length / 2 // we do /2 because we are counting bytes
    const lengthBytes = ethers.utils.hexlify(totalLength).slice(2)
    console.log('Length Bytes:', lengthBytes)
    const lengthBytesLength = lengthBytes.length / 2
    console.log('Length Bytes Length:', lengthBytesLength)
    const lengthByte = 0xf7 + lengthBytesLength
    console.log('Length Byte:', lengthByte)
    const lengthByteHex = ethers.utils.hexlify(lengthByte)
    console.log('Length Byte Hex:', lengthByteHex)
    const concatenatedWithLength =
      lengthByteHex +
      lengthBytes +
      (decompressedBytes.toString('hex') as string)
    //console.log(concatenatedWithLength)
    const decoded = ethers.utils.RLP.decode(concatenatedWithLength)
    //console.log(decoded)

    const batches = []
    let numEmptyBatches = 0
    console.log('Decoding', decoded.length, 'batches')
    for (const [index, batch] of decoded.entries()) {
      const batchHexWithout00 = batch.slice(4) // remove '0x00' from the beginning of a batch. 00 signifies batch version number
      const decodedBatch = ethers.utils.RLP.decode(add0x(batchHexWithout00))
      // decoded batch is [parent_hash, epoch_number, epoch_hash, timestamp, transaction_list]

      if (decodedBatch[decodedBatch.length - 1].length !== 0) {
        // transaction list is not empty
        //console.log(batch)
        console.log()
        console.log('Batch #', index)

        const txs = decodedBatch[decodedBatch.length - 1][0]
        //console.log('txs:', txs)
        const transaction = ethers.utils.RLP.decode(add0x(txs.slice(4))) //rlp([nonce, gasPrice, gasLimit, to, value, data, v, r, s])
        console.log('RLP Decoded transaction:')
        console.log(' ChainId:', parseInt(transaction[0], 16))
        console.log(' SenderNonce:', parseInt(transaction[1], 16))
        console.log(' max_priority_fee_per_gas:', parseInt(transaction[2], 16))
        console.log(' max_fee_per_gas:', parseInt(transaction[3], 16))
        console.log(' gas_limit:', parseInt(transaction[4], 16))
        console.log(' To:', transaction[5])
        console.log(' Value:', transaction[6])
        console.log(' Data:', transaction[7])
        console.log(' AccessList:', transaction[8])
        console.log(' V', transaction[9])
        console.log(' R', transaction[10])
        console.log(' S', transaction[11])
        decodedBatch[decodedBatch.length - 1] = transaction
      } else numEmptyBatches++
      batches.push(decodedBatch)
    }
    console.log('Num of empty batches', numEmptyBatches)
    console.log('First batch:')
    console.log('  Parent_hash', batches[0][0])
    console.log('  Epoch_number', batches[0][1])
    console.log('  Epoch_hash', batches[0][2])
    console.log('  Timestamp', batches[0][3])
    console.log('  Tx_list', batches[0][4])
  }
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
