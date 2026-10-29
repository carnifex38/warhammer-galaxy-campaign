/** Larger pictures (a phone photo of a table, say) are scaled down to this many pixels on the long side before uploading. */
const MAX_SIDE = 2560
/** A picture smaller than this, and no larger than MAX_SIDE, is uploaded as it is. */
const KEEP_BYTES = 2_500_000
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

/** The picture to upload: as chosen when it is small enough (and always for a GIF, which may move), otherwise scaled down. */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= KEEP_BYTES) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85))
  // WebP keeps transparency; a browser that cannot write it (it hands back a PNG instead) gets JPEG
  const webp = await encode('image/webp')
  return webp?.type === 'image/webp' ? webp : ((await encode('image/jpeg')) ?? file)
}
