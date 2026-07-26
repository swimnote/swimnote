/**
 * FullAlbumPickerModal — STUB
 *
 * 실제 구현 파일이 아직 없어 Web 번들 컴파일을 위한 임시 스텁입니다.
 * 네이티브 앱에서는 이 파일이 사용될 수 있으나 실제 기능은 비어 있습니다.
 * 실제 구현 시 이 파일을 교체하세요.
 */

import React from 'react';
import { Modal, Text, View } from 'react-native';

interface FullAlbumPickerModalProps {
  visible:    boolean;
  mediaType?: string;
  token?:     string | null;
  onClose:    () => void;
  onSaved?:   (count: number) => void;
}

export function FullAlbumPickerModal({
  visible,
  onClose,
}: FullAlbumPickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <Text style={{ color: '#fff' }}>앨범 선택 (준비 중)</Text>
      </View>
    </Modal>
  );
}
