/**
 * Zip Safety - Zip Slip Prevention
 *
 * Validates zip file entries to prevent zip slip attacks where
 * malicious archives contain entries with path traversal sequences.
 */

import { resolve, normalize, isAbsolute } from 'path'

// Limits for zip extraction
export const MAX_FILE_SIZE = 10 * 1024 * 1024    // 10MB per file
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024   // 50MB total
export const MAX_FILES = 100                      // Max files in archive

export interface ZipEntryValidation {
  valid: boolean
  error?: string
}

/**
 * Validate a zip entry name for security.
 * Rejects entries with path traversal or suspicious patterns.
 *
 * @param entryName - The filename from the zip entry
 * @returns Validation result
 */
export function validateZipEntryName(entryName: string): ZipEntryValidation {
  // Reject empty names
  if (!entryName || entryName.trim() === '') {
    return { valid: false, error: 'Empty entry name' }
  }

  // Reject absolute paths
  if (isAbsolute(entryName)) {
    return { valid: false, error: `Absolute path not allowed: ${entryName}` }
  }

  // Reject path traversal (before and after normalization)
  if (entryName.includes('..')) {
    return { valid: false, error: `Path traversal not allowed: ${entryName}` }
  }

  // Reject Windows drive letters
  if (/^[A-Za-z]:/.test(entryName)) {
    return { valid: false, error: `Windows drive path not allowed: ${entryName}` }
  }

  // Reject backslashes
  if (entryName.includes('\\')) {
    return { valid: false, error: `Backslash not allowed: ${entryName}` }
  }

  // Reject null bytes
  if (entryName.includes('\0')) {
    return { valid: false, error: 'Null byte not allowed in entry name' }
  }

  // Reject leading slashes
  if (entryName.startsWith('/')) {
    return { valid: false, error: `Leading slash not allowed: ${entryName}` }
  }

  // Normalize and verify it doesn't escape
  const normalized = normalize(entryName)
  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    return { valid: false, error: `Normalized path escapes: ${normalized}` }
  }

  return { valid: true }
}

/**
 * Validate that a zip entry, when extracted, stays within the extraction root.
 *
 * @param entryName - The filename from the zip entry
 * @param extractRoot - The root directory for extraction
 * @returns Validation result
 */
export function validateZipExtraction(
  entryName: string,
  extractRoot: string
): ZipEntryValidation {
  // First validate the entry name itself
  const nameValidation = validateZipEntryName(entryName)
  if (!nameValidation.valid) {
    return nameValidation
  }

  // Verify final path stays under extract root
  const finalPath = resolve(extractRoot, entryName)
  const normalizedRoot = resolve(extractRoot)

  if (!finalPath.startsWith(normalizedRoot + '/') && finalPath !== normalizedRoot) {
    return { valid: false, error: `Path escapes extraction root: ${entryName}` }
  }

  return { valid: true }
}

/**
 * Validate file size against limits
 */
export function validateFileSize(size: number): ZipEntryValidation {
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large: ${size} bytes (max ${MAX_FILE_SIZE} bytes)`,
    }
  }
  return { valid: true }
}

/**
 * Validate total extraction size
 */
export function validateTotalSize(size: number): ZipEntryValidation {
  if (size > MAX_TOTAL_SIZE) {
    return {
      valid: false,
      error: `Archive too large: ${size} bytes (max ${MAX_TOTAL_SIZE} bytes)`,
    }
  }
  return { valid: true }
}

/**
 * Validate file count
 */
export function validateFileCount(count: number): ZipEntryValidation {
  if (count > MAX_FILES) {
    return {
      valid: false,
      error: `Too many files: ${count} (max ${MAX_FILES})`,
    }
  }
  return { valid: true }
}
