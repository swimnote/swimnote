---
name: Photo Upload Performance Optimization
description: P0 photo upload architecture change — smart compression, presigned R2 direct upload for notices and group photos
---

## What changed

### compressImage.ts — new smart policy
- `Image.getSize` for dimension check (no ImageManipulator overhead for small files)
- Resize only if long edge > 1920px (no upscale)
- HEIC/HEIF MIME types → always normalize to JPEG
- Recompress if fileSize > 2MB OR needs resize OR is HEIC
- Very small files (< 512KB, no HEIC) → fast-path skip
- New exports: `compressPhotoAsset(asset)` → `{uri,mimeType,fileSize,fileName}`
- New exports: `compressPhotosParallel(assets, concurrency=2)` — memory-safe parallel compression

### uploads.ts — POST /uploads/presigned
- New endpoint for notice image direct uploads
- Returns `{ items: [{ client_id, object_key, upload_url, headers }] }`
- object_key format: `notices/{poolId}/{uuid}.{ext}`
- GET /uploads/:key display route unchanged (keys still compatible)
- Existing POST /uploads (multipart) still intact for web (SuperNotices.tsx)

### notices.tsx — presigned direct upload
- `uploadImages()` replaced: compress → POST /uploads/presigned → parallel PUT to R2 (concurrency 4)
- No more Render binary proxy for app notice images
- pickedImages state now stores mimeType/fileSize from ImagePicker for better HEIC detection

### photos.tsx (teacher) — directUploadPhotos
- `doUpload()` photo path replaced: compressPhotosParallel(concurrency=2) → directUploadPhotos(concurrency=4)
- No more UploadQueue / FormData / Render multipart for teacher group+private album
- loadList() called directly after upload completes

## What was NOT changed
- directUploadPhotos.ts — unchanged (diary path was already correct)
- MyAlbumPickerModal.tsx — unchanged (diary path already correct)
- photo-upload.tsx admin — unchanged (uses /photos/batch multi-student pattern, different design)
- Video upload — unchanged (separate design, deferred)
- SuperNotices.tsx web — unchanged (web keeps POST /uploads multipart, acceptable)

## Deployment
- main SHA: 326d2914
- Render LIVE: 326d2914
- iOS OTA: 01a0828b-9ed7-719f-8554-8a799d48c153 (branch: production-v2)

**Why:** Render was acting as binary proxy for photo uploads, doubling latency (client→Render→R2). Now photos go client→R2 directly.
