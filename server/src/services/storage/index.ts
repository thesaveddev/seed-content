import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/env';

export interface StorageProvider {
  upload(file: Buffer, filename: string, contentType: string): Promise<string>;
  download(filePath: string): Promise<Buffer>;
  delete(filePath: string): Promise<void>;
  getSignedUrl(filePath: string, expiresIn?: number): Promise<string>;
  getLocalPath(storedPath: string): string;
}

class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(config.STORAGE_DIR);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async upload(file: Buffer, filename: string, _contentType: string): Promise<string> {
    const ext = path.extname(filename);
    const uniqueName = `${uuidv4()}${ext}`;
    const filePath = path.join(this.baseDir, uniqueName);

    // Ensure subdirectory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, file);
    return uniqueName;
  }

  async download(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, filePath);
    return fs.readFileSync(fullPath);
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async getSignedUrl(filePath: string, _expiresIn?: number): Promise<string> {
    // For local storage, return a relative path
    return `/api/files/${filePath}`;
  }

  getLocalPath(storedPath: string): string {
    return path.join(this.baseDir, storedPath);
  }
}

function getStorageProvider(): StorageProvider {
  if (config.STORAGE_PROVIDER === 's3') {
    // TODO: Implement S3 provider
    console.warn('S3 storage not yet implemented, using local storage');
  }
  return new LocalStorageProvider();
}

export const storage = getStorageProvider();
