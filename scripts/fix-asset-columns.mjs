import { readFileSync, writeFileSync } from 'fs';

function fixAssetFile(filePath, alias) {
  let src = readFileSync(filePath, 'utf8');
  const orig = src;

  // Fix column names in photo_assets_meta / video_assets_meta queries
  // These use aliases sp (photos) and sv (videos)

  // 1. SELECT/WHERE column references with table alias
  src = src.replaceAll(`${alias}.swimming_pool_id`, `${alias}.pool_id`);
  src = src.replaceAll(`${alias}.uploader_id`, `${alias}.uploaded_by`);
  src = src.replaceAll(`${alias}.uploader_name`, `${alias}.uploaded_by_name`);
  src = src.replaceAll(`${alias}.file_size_bytes`, `${alias}.file_size`);
  src = src.replaceAll(`${alias}.storage_key`, `${alias}.object_key`);

  // 2. photo.swimming_pool_id / video.swimming_pool_id (fetched row access)
  src = src.replaceAll(`photo.swimming_pool_id`, `photo.pool_id`);
  src = src.replaceAll(`video.swimming_pool_id`, `video.pool_id`);

  // 3. INSERT column lists for photo/video assets meta
  // swimming_pool_id in INSERT → pool_id
  // uploader_id → uploaded_by
  // uploader_name → uploaded_by_name
  // file_size_bytes → file_size
  // storage_key → object_key
  src = src.replaceAll(
    '(id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, file_size_bytes, album_type, class_id)',
    '(id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id)'
  );
  // Also fix VALUES references like "swimming_pool_id" in INSERT contexts for assets meta
  // We need to be careful not to change class_groups / students swimming_pool_id refs

  // 4. checkStorageLimit function
  src = src.replaceAll(`SUM(file_size_bytes)`, `SUM(file_size)`);
  src = src.replaceAll(
    `FROM photo_assets_meta WHERE swimming_pool_id`,
    `FROM photo_assets_meta WHERE pool_id`
  );
  src = src.replaceAll(
    `FROM video_assets_meta WHERE swimming_pool_id`,
    `FROM video_assets_meta WHERE pool_id`
  );

  if (src !== orig) {
    writeFileSync(filePath, src);
    console.log(`FIXED: ${filePath}`);
    // Show remaining old col refs
    const remaining = [];
    for (const old of ['file_size_bytes', 'uploader_id', 'uploader_name', 'storage_key']) {
      if (src.includes(old)) remaining.push(old);
    }
    if (remaining.length) console.log(`  ⚠ 미수정 참조: ${remaining.join(', ')}`);
    else console.log('  ✓ 모든 컬럼명 수정 완료');
  } else {
    console.log(`SKIP: ${filePath} (변경 없음)`);
  }
}

fixAssetFile('artifacts/api-server/src/routes/photos.ts', 'sp');
fixAssetFile('artifacts/api-server/src/routes/videos.ts', 'sv');
