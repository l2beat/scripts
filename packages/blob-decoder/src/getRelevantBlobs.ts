import { assert } from '@l2beat/backend-tools'
import { Hash256 } from '@l2beat/types'
import { utils } from 'ethers'

const RPC_URL = 'https://1rpc.io/sepolia'

/**
 * https://ethereum.github.io/beacon-APIs/
 */
const BEACON_API = 'https://ethereum-sepolia-beacon-api.publicnode.com'

/**
 * This function returns blobs associated with a transaction
 * @param tx that contains the blobs
 * @returns the blobs associated with the transaction
 */
export async function getRelevantBlobs(tx: {
  hash: Hash256
  blockNumber: number
}) {
  const blobVersionedHashes = await getBlobVersionedHashes(tx.hash)
  const sidecar = await getBlobSidecar(tx.blockNumber)
  const blobsWithVersionedHash = sidecar.map(({ kzg_commitment, ...rest }) => ({
    versionedHash: kzgCommitmentToVersionedHash(kzg_commitment),
    kzg_commitment,
    ...rest,
  }))
  const relevantBlobs = blobsWithVersionedHash.filter((blob) => {
    return blobVersionedHashes.includes(blob.versionedHash)
  })

  assert(relevantBlobs.length > 0, 'No relevant blobs found')

  return relevantBlobs
}

async function getBlobVersionedHashes(tx: Hash256) {
  const txData = (await fetchRpc('eth_getTransactionByHash', [
    tx.toString(),
  ])) as { blobVersionedHashes: string[] }

  const blobVersionedHashes = txData.blobVersionedHashes.map((hash: string) =>
    Hash256(hash),
  )

  return blobVersionedHashes
}

async function getBlobSidecar(blockNumber: number) {
  const blockId = await getBeaconBlockId(blockNumber)
  const url = `${BEACON_API}/eth/v1/beacon/blob_sidecar/${blockId}`
  console.log('fetching sidecar from', url)
  const response = await fetch(
    `${BEACON_API}/eth/v1/beacon/blob_sidecars/${blockId}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
    },
  )

  const json = (await response.json()) as { data: { kzg_commitment: string }[] }

  assert(json.data, 'No sidecar data found')

  return json.data
}

async function getBeaconBlockId(blockNumber: number) {
  const data = (await fetchRpc('eth_getBlockByNumber', [
    utils.hexValue(blockNumber + 1),
    false,
  ])) as {
    parentBeaconBlockRoot: string
  }

  return data.parentBeaconBlockRoot
}

function kzgCommitmentToVersionedHash(commitment: string) {
  return Hash256('0x01' + utils.sha256(commitment).substring(4))
}

async function fetchRpc(method: string, params?: unknown[]) {
  const id = Math.floor(Math.random() * 1000)
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  })

  const json = (await response.json()) as { result: unknown; error?: unknown }

  if (json.error) {
    throw new Error(
      'Error in rpc response, method: ' +
        method +
        ' error: ' +
        JSON.stringify(json.error),
    )
  }

  return json.result
}
