import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'

import { CacheBackend } from './Cache'
import { NestedDict } from './NestedDict'

export class FileCacheBackend implements CacheBackend {
  private readonly filename: string = `.cache/cache.json`

  constructor(filename?: string) {
    if (filename) {
      this.filename = filename
    }
  }

  read(): NestedDict {
    if (!fs.existsSync(this.filename)) {
      return new NestedDict({})
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'))
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return new NestedDict(data)
  }

  write(data: NestedDict) {
    const absolute = path.resolve(this.filename)
    mkdirp.sync(path.dirname(absolute))
    fs.writeFileSync(absolute, JSON.stringify(data.data, null, 2))
  }
}
