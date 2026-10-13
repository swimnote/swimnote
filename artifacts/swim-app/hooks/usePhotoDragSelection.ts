import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AppState, FlatList, View } from "react-native";
import type { GestureResponderEvent } from "react-native";
import {
  edgeScrollSpeed, photoIndexAt, PhotoDragSession, samplePhotoPath,
} from "@/utils/photoDragSelection";
import type { GridGeometry } from "@/utils/photoDragSelection";

interface Options extends GridGeometry {
  enabled: boolean;
  ids: (string | null)[];
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  limit?: number;
}

/** Long hold arms selection; immediate swipes remain native list scrolling. */
export function usePhotoDragSelection<T>(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const containerRef = useRef<View>(null);
  const listRef = useRef<FlatList<T>>(null);
  const viewport = useRef({ x: 0, y: 0, height: 0, width: 0 });
  const scroll = useRef(0);
  const contentHeight = useRef(0);
  const session = useRef<PhotoDragSession | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const suppressPress = useRef(false);
  const [dragging, setDragging] = useState(false);

  function measure() {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      viewport.current = { x, y, width, height };
    });
  }

  function finish(updateState = true) {
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastFrame.current = 0;
    if (updateState) setDragging(false);
  }

  useEffect(() => {
    if (!options.enabled) finish();
  }, [options.enabled]);
  useEffect(() => () => finish(false), []);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state !== "active") finish();
    });
    return () => listener.remove();
  }, []);

  function visitId(id: string | null | undefined) {
    const current = session.current;
    if (!current || !current.visit(id) || !id) return;
    const { setSelected, limit } = latest.current;
    setSelected(prev => current.apply(prev, id, limit));
  }

  function hit(x: number, y: number) {
    const v = viewport.current;
    if (x < v.x || x >= v.x + v.width || y < v.y || y >= v.y + v.height) return;
    const o = latest.current;
    visitId(o.ids[photoIndexAt(x - v.x, y - v.y + scroll.current, o.ids.length, o)]);
  }

  function tick(time: number) {
    frame.current = null;
    if (!session.current || !latest.current.enabled) return;
    const dt = lastFrame.current ? Math.min(32, time - lastFrame.current) / 1000 : 0.016;
    lastFrame.current = time;
    const v = viewport.current;
    const speed = pointer.current.x >= v.x && pointer.current.x < v.x + v.width
      ? edgeScrollSpeed(pointer.current.y - v.y, v.height) : 0;
    const next = Math.max(0, Math.min(Math.max(0, contentHeight.current - v.height), scroll.current + speed * dt));
    if (speed && next !== scroll.current) {
      scroll.current = next;
      listRef.current?.scrollToOffset({ offset: next, animated: false });
      hit(pointer.current.x, pointer.current.y);
    }
    frame.current = requestAnimationFrame(tick);
  }

  function move(event: GestureResponderEvent) {
    if (!session.current) return;
    if (event.nativeEvent.touches.length !== 1) { finish(); return; }
    const next = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    samplePhotoPath(pointer.current, next, hit);
    pointer.current = next;
  }

  function cellProps(id: string, onTap: () => void, onInactiveLongPress?: () => void) {
    return {
      delayLongPress: 250,
      onPressIn: () => { suppressPress.current = false; },
      onPress: () => { if (!suppressPress.current) onTap(); },
      onLongPress: (event: GestureResponderEvent) => {
        if (!latest.current.enabled) { onInactiveLongPress?.(); return; }
        if (event.nativeEvent.touches.length > 1) return;
        suppressPress.current = true;
        measure();
        session.current = new PhotoDragSession(id, latest.current.selected);
        pointer.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        visitId(id);
        setDragging(true);
        lastFrame.current = 0;
        frame.current = requestAnimationFrame(tick);
      },
    };
  }

  return {
    cellProps,
    containerProps: {
      ref: containerRef,
      collapsable: false,
      onLayout: measure,
      onMoveShouldSetResponderCapture: () => !!session.current,
      onResponderMove: move,
      onResponderRelease: () => finish(),
      onResponderTerminate: () => finish(),
      onResponderTerminationRequest: () => !session.current,
      onTouchEnd: () => finish(),
      onTouchCancel: () => finish(),
    },
    listProps: {
      ref: listRef,
      scrollEnabled: !dragging,
      scrollEventThrottle: 16,
      extraData: options.selected,
      onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        scroll.current = event.nativeEvent.contentOffset.y;
        if (session.current) hit(pointer.current.x, pointer.current.y);
      },
      onContentSizeChange: (_width: number, height: number) => { contentHeight.current = height; },
    },
  };
}
