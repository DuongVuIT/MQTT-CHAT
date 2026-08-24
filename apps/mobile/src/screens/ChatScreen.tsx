import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Clipboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { mediaUrl } from '../lib/config';
import type { ApiMessage } from '../lib/api';
import type { PendingMessage } from '../features/messaging/message-lifecycle';
import {
  buildChatRows,
  formatSize,
  formatTime,
  mediaInfo,
  type ChatRow,
} from '../features/messaging/message-rows';
import {
  avatarColorFor,
  colors,
  elevation,
  motion,
  radius,
  spacing,
  TOUCH_TARGET,
} from '../theme/tokens';

/**
 * Chat screen v2 (phase-2 §10/§11/§12/§13/§14/§15/§16/§17/§19/§20/§21):
 *  - INVERTED transcript: offset 0 IS the latest message — open-at-latest is
 *    immediate (no top-of-list flash), older pages prepend beyond the anchor
 *    without any viewport compensation, and pinned appends follow for free.
 *  - Row model built by the pure buildChatRows (grouping/date separators/
 *    reaction chips/reply resolution) and rendered through a memoized
 *    MessageRow — composer keystrokes do NOT re-render bubbles (§47).
 *  - Subtle receipts: clock → ✓ → ✓✓ (read watermark), failed + Retry (§14).
 *  - Composer: attachment sheet, reply/edit banners, auto-grow input,
 *    44pt targets, keyboard-safe (§19).
 * All actions go through canonical commands — never local-only mutations.
 */

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const;

/** Friendly label for the wire enum — never render FILE/VOICE raw (§11). */
const TYPE_LABEL: Record<string, string> = {
  IMAGE: 'Photo',
  VIDEO: 'Video',
  FILE: 'File',
  VOICE: 'Voice message',
  SYSTEM: 'System',
};

function fileGlyph(mimeType: string, filename: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return '📕';
  if (m.startsWith('text/') || /\.(txt|md|csv)$/i.test(filename)) return '📄';
  if (m.includes('zip') || /\.(zip|tar|gz|rar)$/i.test(filename)) return '🗂️';
  if (m.includes('sheet') || /\.(xlsx|numbers|csv)$/i.test(filename))
    return '📊';
  return '📎';
}

export interface ChatActions {
  send(content: string, replyToId: string | null): void;
  edit(messageId: string, content: string): void;
  delete(messageId: string): void;
  /** Toggle the active user's reaction; `remove` decides add vs remove. */
  react(messageId: string, emoji: string, remove: boolean): void;
  pickImage(): void;
  pickDocument(): void;
}

/** One-shot mount fade/rise — arrival motion for NEW rows only (§40). */
function useArrivalMotion(
  enabled: boolean,
  onDone?: () => void,
): {
  opacity: Animated.Value;
  translateY: Animated.Value;
} {
  const opacity = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(enabled ? 10 : 0)).current;
  useEffect(() => {
    if (!enabled) return;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.normal,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.normal,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone?.();
    });
    // onDone intentionally excluded: it must not retrigger the animation.
  }, [enabled, opacity, translateY]);
  return { opacity, translateY };
}

const MessageRow = React.memo(function MessageRow({
  row,
  onLongPress,
  onToggleChip,
  onOpenImage,
  onOpenFile,
  animateIn,
  onAnimateDone,
}: {
  row: Extract<ChatRow, { kind: 'message' }>;
  onLongPress: (message: ApiMessage) => void;
  onToggleChip: (message: ApiMessage, emoji: string, remove: boolean) => void;
  onOpenImage: (storageKey: string, filename: string) => void;
  onOpenFile: (storageKey: string) => void;
  animateIn: boolean;
  onAnimateDone: (key: string) => void;
}): React.JSX.Element {
  const { opacity, translateY } = useArrivalMotion(animateIn, () =>
    onAnimateDone(row.key),
  );
  const { message: m, mine } = row;
  const info = !m.deletedAt && m.type !== 'TEXT' ? mediaInfo(m) : null;

  // Corner shaping follows the run: first bubble keeps its top corners round,
  // the run's tail tightens toward the sender (§12).
  const bubbleRadius = {
    borderTopLeftRadius: row.startsGroup || mine ? radius.bubble : 6,
    borderTopRightRadius: row.startsGroup || !mine ? radius.bubble : 6,
    borderBottomLeftRadius: row.endsGroup || mine ? radius.bubble : 6,
    borderBottomRightRadius: row.endsGroup || !mine ? radius.bubble : 6,
  };

  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <Animated.View
      style={[
        styles.rowWrap,
        mine ? styles.rowWrapMine : styles.rowWrapTheirs,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      {row.showSender && (
        <View style={styles.senderRow}>
          <View
            style={[
              styles.senderDot,
              { backgroundColor: avatarColorFor(m.senderId).bg },
            ]}
          />
          <Text style={styles.sender}>{m.senderName}</Text>
        </View>
      )}
      <Pressable
        onLongPress={() => onLongPress(m)}
        delayLongPress={250}
        android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
        style={({ pressed }) => [
          styles.bubble,
          bubbleRadius,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          m.deletedAt && styles.bubbleDeleted,
          pressed && styles.bubblePressed,
        ]}
        accessibilityLabel={
          m.deletedAt
            ? 'Message deleted'
            : `${mine ? 'You' : m.senderName} said: ${m.content || (info ? info.filename : '')} at ${formatTime(m.createdAt)}`
        }
      >
        {row.replySource && (
          <View
            style={[
              styles.replyPreview,
              mine ? styles.replyPreviewMine : styles.replyPreviewTheirs,
            ]}
          >
            <Text style={styles.replyName} numberOfLines={1}>
              {row.replySource.senderName}
            </Text>
            <Text style={styles.replyContent} numberOfLines={2}>
              {row.replySource.deletedAt
                ? 'Message deleted'
                : row.replySource.content ||
                  (mediaInfo(row.replySource)?.filename ?? 'Attachment')}
            </Text>
          </View>
        )}
        {m.deletedAt ? (
          <Text style={styles.deletedText}>Message deleted</Text>
        ) : info && m.type === 'IMAGE' ? (
          <Pressable
            onPress={() => onOpenImage(info.storageKey, info.filename)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open photo ${info.filename}`}
          >
            <View style={styles.imageWrap}>
              {!imageLoaded && <View style={styles.imagePlaceholder} />}
              <Image
                source={{ uri: mediaUrl(info.storageKey) }}
                style={[
                  styles.image,
                  imageLoaded ? styles.imageReady : styles.imageHidden,
                ]}
                resizeMode="cover"
                onLoad={() => setImageLoaded(true)}
              />
            </View>
          </Pressable>
        ) : info ? (
          <Pressable
            style={styles.fileCard}
            onPress={() => onOpenFile(info.storageKey)}
            accessibilityRole="button"
            accessibilityLabel={`Open file ${info.filename}`}
          >
            <Text style={styles.fileIcon}>
              {fileGlyph(info.mimeType, info.filename)}
            </Text>
            <View style={styles.fileMeta}>
              <Text style={styles.fileName} numberOfLines={1}>
                {info.filename}
              </Text>
              <Text style={styles.fileSub}>
                {TYPE_LABEL[m.type] ?? TYPE_LABEL.FILE}
                {info.size > 0 ? ` · ${formatSize(info.size)}` : ''}
              </Text>
            </View>
            <Text style={styles.fileChevron}>›</Text>
          </Pressable>
        ) : (
          <Text style={[styles.content, mine ? styles.contentMine : undefined]}>
            {m.content}
          </Text>
        )}
        <View style={styles.metaRow}>
          {m.editedAt && !m.deletedAt && (
            <Text style={[styles.meta, mine ? styles.metaMine : undefined]}>
              edited
            </Text>
          )}
          <Text style={[styles.time, mine ? styles.timeMine : undefined]}>
            {formatTime(m.createdAt)}
          </Text>
          {mine && !m.deletedAt && (
            <Text
              style={[
                styles.receipt,
                row.read ? styles.receiptRead : styles.receiptSent,
              ]}
              accessibilityLabel={row.read ? 'Read' : 'Sent'}
            >
              {row.read ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </Pressable>
      {row.chips.length > 0 && (
        <View
          style={[
            styles.chipRow,
            mine ? styles.chipRowMine : styles.chipRowTheirs,
          ]}
        >
          {row.chips.map(chip => (
            <Pressable
              key={chip.emoji}
              onPress={() => onToggleChip(m, chip.emoji, chip.mine)}
              style={({ pressed }) => [
                styles.chip,
                chip.mine && styles.chipMine,
                pressed && styles.chipPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${chip.emoji} ${chip.count} — ${chip.mine ? 'remove your reaction' : 'react too'}`}
            >
              <Text style={styles.chipEmoji}>{chip.emoji}</Text>
              {chip.count > 1 && (
                <Text
                  style={[styles.chipCount, chip.mine && styles.chipCountMine]}
                >
                  {chip.count}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </Animated.View>
  );
});

const PendingRow = React.memo(function PendingRow({
  row,
  onRetry,
}: {
  row: Extract<ChatRow, { kind: 'pending' }>;
  onRetry: (clientMessageId: string) => void;
}): React.JSX.Element {
  const p = row.pending;
  const failed = p.status === 'failed';
  return (
    <View style={[styles.rowWrap, styles.rowWrapMine]}>
      <View
        style={[
          styles.bubble,
          styles.bubbleMine,
          failed && styles.bubbleFailed,
        ]}
      >
        {row.media ? (
          <View style={styles.fileCard}>
            <Text style={styles.fileIcon}>
              {row.media.type === 'IMAGE' ? '🖼️' : '📎'}
            </Text>
            <View style={styles.fileMeta}>
              <Text style={styles.fileName} numberOfLines={1}>
                {row.media.filename}
              </Text>
              <Text style={styles.fileSub}>
                {failed ? 'Upload failed' : 'Uploading…'}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.contentMine}>{p.content}</Text>
        )}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, styles.metaMine]}>
            {failed
              ? 'Failed to send'
              : p.status === 'queued'
                ? 'Waiting for connection…'
                : 'Sending…'}
          </Text>
          {failed && (
            <Pressable
              onPress={() => onRetry(p.clientMessageId)}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry sending"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
});

export function ChatScreen({
  title,
  subtitle,
  peerInitials,
  messages,
  pending,
  typingUsers,
  identityUserId,
  isGroup,
  readWatermark = 0,
  hasMoreHistory = false,
  loadingEarlier = false,
  loadingHistory = false,
  historyError = null,
  onLoadEarlier,
  onRetryHistory,
  actions,
  onSend,
  onRetry,
  onBack,
  onTypingChange,
  onOpenDetails,
}: {
  title: string;
  subtitle?: string;
  /** Peer/group initials for the header avatar. */
  peerInitials: string;
  messages: ApiMessage[];
  pending: PendingMessage[];
  typingUsers: string[];
  identityUserId: string | null;
  isGroup: boolean;
  /** Max lastReadSequence among OTHER members — read receipts (§14). */
  readWatermark?: number;
  /** Older history exists for this conversation (cursor pagination). */
  hasMoreHistory?: boolean;
  loadingEarlier?: boolean;
  /** First history page still in flight → skeleton, not a false empty state. */
  loadingHistory?: boolean;
  historyError?: string | null;
  onLoadEarlier?: () => void;
  onRetryHistory?: () => void;
  actions: ChatActions;
  onSend: (content: string, replyToId: string | null) => void;
  onRetry: (clientMessageId: string) => void;
  onBack: () => void;
  onTypingChange: (isTyping: boolean) => void;
  onOpenDetails: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [inputHeight, setInputHeight] = useState(0);
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null);
  const [editing, setEditing] = useState<ApiMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ApiMessage | null>(null);
  const [attachSheet, setAttachSheet] = useState(false);
  const [lightbox, setLightbox] = useState<{
    key: string;
    filename: string;
  } | null>(null);
  // New-message counter while the reader is scrolled away from the bottom.
  const [newCount, setNewCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const listRef = useRef<FlatList<ChatRow>>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // ---- Canonical scroll model (inverted list) ----------------------------
  // Offset 0 is the newest message. Appends at offset 0 stay visible with NO
  // programmatic scroll; when the reader is scrolled up the new content
  // grows below the viewport and `newCount` ticks (§35). Own sends always
  // return to offset 0 (§38).
  const pinnedRef = useRef(true);
  const seenIdsRef = useRef<Set<string> | null>(null);
  const arrivedRef = useRef(new Set<string>());
  const pendingCountRef = useRef(pending.length);
  const prevLastIdRef = useRef<string>('');

  const rows = useMemo(
    () =>
      buildChatRows(messages, pending, {
        identityUserId,
        isGroup,
        readWatermark,
      }),
    [messages, pending, identityUserId, isGroup, readWatermark],
  );

  // Arrival tracking (§40/§41): only rows appended AFTER the newest-known id
  // animate in — history loads, prepends and gap-fills stay perfectly still.
  useEffect(() => {
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(messages.map(m => m.id));
      prevLastIdRef.current = messages[messages.length - 1]?.id ?? '';
      return;
    }
    const lastId = messages[messages.length - 1]?.id ?? '';
    for (const m of messages) {
      if (!seenIdsRef.current.has(m.id)) {
        seenIdsRef.current.add(m.id);
        if (lastId === m.id && prevLastIdRef.current !== m.id) {
          arrivedRef.current.add(m.id);
        }
      }
    }
    prevLastIdRef.current = lastId;
  }, [messages]);

  const handleAnimateDone = useCallback((key: string) => {
    // Drop the arrival flag so list virtualization remounts never replay.
    arrivedRef.current.delete(key);
  }, []);

  const followLatest = useCallback((animated: boolean) => {
    pinnedRef.current = true;
    setNewCount(0);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);

  useEffect(() => {
    // Own send (pending grew) → always show it (§38).
    const grew = pending.length > pendingCountRef.current;
    pendingCountRef.current = pending.length;
    if (grew && pending.length > 0) followLatest(true);
  }, [pending.length, followLatest]);

  const handleScroll = useCallback(
    ({
      nativeEvent: e,
    }: {
      nativeEvent: { contentOffset: { y: number } };
    }): void => {
      const nearBottom = e.contentOffset.y < 80;
      pinnedRef.current = nearBottom;
      if (nearBottom && newCount > 0) setNewCount(0);
    },
    [newCount],
  );

  const goToLatest = useCallback(() => followLatest(true), [followLatest]);

  const handleDraft = (text: string): void => {
    setDraft(text);
    onTypingChange(text.length > 0);
  };

  const submit = (): void => {
    const content = draft.trim();
    if (!content) return;
    if (editing) {
      actions.edit(editing.id, content);
      setEditing(null);
      setDraft('');
      onTypingChange(false);
      return;
    }
    onSend(content, replyTo?.id ?? null);
    setReplyTo(null);
    setDraft('');
    onTypingChange(false);
  };

  const onToggleChip = useCallback(
    (message: ApiMessage, emoji: string, remove: boolean) => {
      actions.react(message.id, emoji, remove);
    },
    [actions],
  );
  const onLongPressRow = useCallback((message: ApiMessage) => {
    setMenuFor(message);
  }, []);
  const onOpenImage = useCallback((key: string, filename: string) => {
    setLightbox({ key, filename });
  }, []);
  const onOpenFile = useCallback((key: string) => {
    void Linking.openURL(mediaUrl(key)).catch(() => {});
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ChatRow }) => {
      if (item.kind === 'date') {
        return (
          <View style={styles.dateWrap}>
            <View style={styles.datePill}>
              <Text style={styles.dateText}>{item.label}</Text>
            </View>
          </View>
        );
      }
      if (item.kind === 'pending') {
        return <PendingRow row={item} onRetry={onRetry} />;
      }
      return (
        <MessageRow
          row={item}
          onLongPress={onLongPressRow}
          onToggleChip={onToggleChip}
          onOpenImage={onOpenImage}
          onOpenFile={onOpenFile}
          animateIn={!reduceMotion && arrivedRef.current.has(item.key)}
          onAnimateDone={handleAnimateDone}
        />
      );
    },
    [
      onLongPressRow,
      onToggleChip,
      onOpenImage,
      onOpenFile,
      onRetry,
      reduceMotion,
      handleAnimateDone,
    ],
  );

  const canSend = draft.trim().length > 0 || editing !== null;
  const avatar = avatarColorFor(title);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        avatar={peerInitials}
        avatarColor={isGroup ? colors.surfaceHigh : avatar.bg}
        onBack={onBack}
        onPressTitle={onOpenDetails}
        right={
          <Pressable
            onPress={onOpenDetails}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Open details"
          >
            <Text style={styles.headerActionText}>ⓘ</Text>
          </Pressable>
        }
      />

      {/* History error surface (§64) — contextual, never raw fetch text */}
      {historyError && messages.length === 0 ? (
        <View style={styles.errorState}>
          <Text style={styles.errorTitle}>Couldn’t load messages</Text>
          <Text style={styles.errorBody}>{historyError}</Text>
          {onRetryHistory && (
            <Pressable
              style={styles.errorRetry}
              onPress={onRetryHistory}
              accessibilityRole="button"
              accessibilityLabel="Retry loading messages"
            >
              <Text style={styles.errorRetryText}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.listContainer}>
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={r => r.key}
            // INVERTED: the newest row lives at offset 0. Opening lands on
            // the latest message with zero scroll work; older pages prepend
            // beyond the viewport without moving it (§34/§37).
            inverted
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={9}
            contentContainerStyle={styles.listContent}
            onScroll={handleScroll}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              // Data end = visual TOP (oldest). Fires only on real upward
              // reading — never during the initial mount at offset 0.
              if (hasMoreHistory && !loadingEarlier) onLoadEarlier?.();
            }}
            ListHeaderComponent={
              // Visual bottom (inverted): pending sends + typing indicator.
              <>
                {typingUsers.length > 0 && (
                  <Text style={styles.typing} numberOfLines={1}>
                    {typingUsers.join(', ')}{' '}
                    {typingUsers.length === 1 ? 'is' : 'are'} typing…
                  </Text>
                )}
              </>
            }
            ListFooterComponent={
              // Visual top (inverted): older-page loader.
              loadingEarlier ? (
                <View style={styles.earlierLoader}>
                  <Text style={styles.earlierText}>
                    Loading earlier messages…
                  </Text>
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              loadingHistory ? (
                <ChatSkeleton />
              ) : (
                <View style={styles.emptyChatWrap}>
                  <Text style={styles.emptyChatIcon}>👋</Text>
                  <Text style={styles.emptyChatTitle}>No messages yet</Text>
                  <Text style={styles.emptyChatBody}>
                    Say hello — messages arrive in realtime.
                  </Text>
                </View>
              )
            }
            renderItem={renderItem}
          />
          {/* Floating jump-to-latest chip (§36) — overlays the transcript. */}
          {newCount > 0 && (
            <NewMessagePill count={newCount} onPress={goToLatest} />
          )}
        </View>
      )}

      {/* Composer — attachment + reply/edit banners + input + send (§19) */}
      <View
        style={[
          styles.composer,
          {
            paddingBottom: Math.max(
              insets.bottom,
              Platform.OS === 'ios' ? 10 : 6,
            ),
          },
        ]}
      >
        {(replyTo || editing) && (
          <View style={styles.banner}>
            <View style={styles.bannerAccent} />
            <View style={styles.bannerBody}>
              <Text style={styles.bannerLabel}>
                {editing
                  ? 'Editing message'
                  : `Replying to ${replyTo?.senderName ?? ''}`}
              </Text>
              <Text style={styles.bannerText} numberOfLines={1}>
                {editing
                  ? editing.content || 'Attachment'
                  : replyTo?.content ||
                    (replyTo
                      ? (mediaInfo(replyTo)?.filename ?? 'Attachment')
                      : '')}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setReplyTo(null);
                setEditing(null);
              }}
              style={styles.bannerClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.bannerCloseText}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.composerRow}>
          <Pressable
            style={({ pressed }) => [
              styles.roundBtn,
              pressed && styles.roundBtnPressed,
            ]}
            onPress={() => setAttachSheet(true)}
            accessibilityRole="button"
            accessibilityLabel="Attach photo or file"
          >
            <Text style={styles.attachIcon}>＋</Text>
          </Pressable>
          <TextInput
            style={[styles.input, { height: Math.max(44, inputHeight) }]}
            value={draft}
            onChangeText={handleDraft}
            placeholder={editing ? 'Edit message…' : 'Message'}
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={submit}
            returnKeyType="send"
            multiline
            onContentSizeChange={e =>
              setInputHeight(e.nativeEvent.contentSize.height)
            }
            accessibilityLabel="Message input"
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              !canSend && styles.sendBtnIdle,
              pressed && styles.roundBtnPressed,
            ]}
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save edit' : 'Send message'}
          >
            <Text style={styles.sendIcon}>{editing ? '✓' : '➤'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Attachment chooser (§18) — explicit menu, slide-up sheet */}
      <Modal
        visible={attachSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachSheet(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setAttachSheet(false)}
        >
          <Pressable
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + spacing.lg },
            ]}
            onPress={() => undefined}
          >
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetHeading}>Attach</Text>
            <Pressable
              style={({ pressed }) => [
                styles.sheetOption,
                pressed && styles.sheetOptionPressed,
              ]}
              onPress={() => {
                setAttachSheet(false);
                actions.pickImage();
              }}
              accessibilityRole="button"
              accessibilityLabel="Choose photo"
            >
              <View
                style={[
                  styles.sheetIconWrap,
                  { backgroundColor: colors.primarySoft },
                ]}
              >
                <Text style={styles.sheetIcon}>🖼️</Text>
              </View>
              <View style={styles.sheetTextWrap}>
                <Text style={styles.sheetOptionTitle}>Photo</Text>
                <Text style={styles.sheetOptionBody}>From your library</Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.sheetOption,
                pressed && styles.sheetOptionPressed,
              ]}
              onPress={() => {
                setAttachSheet(false);
                actions.pickDocument();
              }}
              accessibilityRole="button"
              accessibilityLabel="Choose document"
            >
              <View
                style={[
                  styles.sheetIconWrap,
                  { backgroundColor: colors.successSoft },
                ]}
              >
                <Text style={styles.sheetIcon}>📄</Text>
              </View>
              <View style={styles.sheetTextWrap}>
                <Text style={styles.sheetOptionTitle}>Document</Text>
                <Text style={styles.sheetOptionBody}>PDF up to 50 MB</Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.sheetCancel,
                pressed && styles.sheetOptionPressed,
              ]}
              onPress={() => setAttachSheet(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel attach"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Long-press action menu (§17) — only valid actions, ever */}
      <Modal
        visible={menuFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setMenuFor(null)}>
          <Pressable
            style={[
              styles.menuSheet,
              { paddingBottom: insets.bottom + spacing.md },
            ]}
            onPress={() => undefined}
          >
            <View style={styles.sheetGrabber} />
            <View style={styles.reactionBar}>
              {QUICK_REACTIONS.map(emoji => (
                <Pressable
                  key={emoji}
                  style={({ pressed }) => [
                    styles.reactionBtn,
                    pressed && styles.reactionBtnPressed,
                  ]}
                  onPress={() => {
                    if (menuFor) actions.react(menuFor.id, emoji, false);
                    setMenuFor(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {menuFor && !menuFor.deletedAt && (
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
                onPress={() => {
                  setReplyTo(menuFor);
                  setMenuFor(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Reply"
              >
                <Text style={styles.menuItemIcon}>↩</Text>
                <Text style={styles.menuItemText}>Reply</Text>
              </Pressable>
            )}
            {menuFor && !menuFor.deletedAt && menuFor.content.length > 0 && (
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
                onPress={() => {
                  void Clipboard.setString(menuFor.content);
                  setMenuFor(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Copy message text"
              >
                <Text style={styles.menuItemIcon}>⧉</Text>
                <Text style={styles.menuItemText}>Copy</Text>
              </Pressable>
            )}
            {menuFor?.senderId === identityUserId &&
              !menuFor.deletedAt &&
              menuFor.type === 'TEXT' && (
                <Pressable
                  style={({ pressed }) => [
                    styles.menuItem,
                    pressed && styles.menuItemPressed,
                  ]}
                  onPress={() => {
                    if (menuFor) {
                      setEditing(menuFor);
                      setDraft(menuFor.content);
                    }
                    setMenuFor(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Edit message"
                >
                  <Text style={styles.menuItemIcon}>✎</Text>
                  <Text style={styles.menuItemText}>Edit</Text>
                </Pressable>
              )}
            {menuFor?.senderId === identityUserId && !menuFor.deletedAt && (
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
                onPress={() => {
                  if (menuFor) actions.delete(menuFor.id);
                  setMenuFor(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Delete message"
              >
                <Text style={[styles.menuItemIcon, styles.menuItemDanger]}>
                  🗑
                </Text>
                <Text style={[styles.menuItemText, styles.menuItemDanger]}>
                  Delete
                </Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.menuCancel,
                pressed && styles.menuItemPressed,
              ]}
              onPress={() => setMenuFor(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* In-app photo viewer (§20) — no external browser jump */}
      <Modal
        visible={lightbox !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <Pressable style={styles.lightbox} onPress={() => setLightbox(null)}>
          {lightbox && (
            <Image
              source={{ uri: mediaUrl(lightbox.key) }}
              style={styles.lightboxImage}
              resizeMode="contain"
              accessibilityLabel={lightbox.filename}
            />
          )}
          <View style={styles.lightboxClose}>
            <Text style={styles.lightboxCloseText}>✕</Text>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/** Floating "↓ N new messages" chip — opacity/translate entrance only (§36). */
function NewMessagePill({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}): React.JSX.Element {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: motion.fast,
      useNativeDriver: true,
    }).start();
  }, [anim]);
  return (
    <Animated.View
      style={[
        styles.newPill,
        elevation.floating,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.newPillBtn,
          pressed && styles.newPillPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Jump to ${count} new message${count === 1 ? '' : 's'}`}
      >
        <Text style={styles.newPillText}>
          ↓ {count} new message{count === 1 ? '' : 's'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Lightweight transcript skeleton (§66) — no flashing blank areas. */
function ChatSkeleton(): React.JSX.Element {
  const bubbles = [0.72, 0.5, 0.62, 0.44, 0.68];
  return (
    <View>
      {bubbles.map((w, i) => (
        <View
          key={i}
          style={[i % 2 === 0 ? styles.rowWrapTheirs : styles.rowWrapMine]}
        >
          <View
            style={[
              styles.skeletonBubble,
              i % 2 === 0 ? styles.skeletonTheirs : styles.skeletonMine,
              { width: `${Math.round(w * 100)}%` },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * Read watermark (max lastReadSequence among OTHER members) is a plain prop —
 * AppRoot derives it from session.conversations members.
 */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerAction: {
    minWidth: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: colors.primaryStrong, fontSize: 20 },

  // ---- Transcript ---------------------------------------------------------
  listContainer: { flex: 1 },
  listContent: { paddingVertical: spacing.sm },
  rowWrap: {
    marginHorizontal: spacing.md,
    marginVertical: 1.5,
    maxWidth: '78%',
  },
  rowWrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowWrapTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 2,
    marginBottom: 3,
    marginTop: 6,
  },
  senderDot: { width: 8, height: 8, borderRadius: 4 },
  sender: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  bubble: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceRaised,
    marginTop: 2,
  },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.surfaceRaised },
  bubbleDeleted: { backgroundColor: colors.surface },
  bubblePressed: { opacity: 0.88 },
  content: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  contentMine: { color: colors.onPrimary },
  deletedText: {
    color: colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  // Media (§20): reserved dimensions — no layout shift on load.
  imageWrap: { position: 'relative' },
  image: {
    width: 220,
    height: 160,
    borderRadius: radius.md,
  },
  imageReady: { opacity: 1 },
  imageHidden: { opacity: 0 },
  imagePlaceholder: {
    position: 'absolute',
    width: 220,
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  // File card (§21): icon + name + size, chevron affordance, no raw keys.
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 190,
  },
  fileIcon: { fontSize: 26 },
  fileMeta: { flex: 1 },
  fileName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  fileSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  fileChevron: { color: colors.textMuted, fontSize: 18, fontWeight: '600' },
  // Meta + receipts (§14): quiet ticks, never large status words.
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 3,
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
  meta: { color: colors.textSecondary, fontSize: 10 },
  metaMine: { color: 'rgba(255,255,255,0.75)' },
  time: { color: colors.textMuted, fontSize: 10 },
  timeMine: { color: 'rgba(255,255,255,0.55)' },
  receipt: { fontSize: 10, fontWeight: '700', letterSpacing: -1 },
  receiptSent: { color: 'rgba(255,255,255,0.55)' },
  receiptRead: { color: '#B9C4FF' },
  // Reply preview (§15): accent line + sender + truncated content.
  replyPreview: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 6,
    gap: 1,
  },
  replyPreviewMine: { borderLeftColor: 'rgba(255,255,255,0.6)' },
  replyPreviewTheirs: { borderLeftColor: colors.primaryStrong },
  replyName: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.85,
  },
  replyContent: { color: colors.textSecondary, fontSize: 12 },
  // Reaction chips (§16): compact, thumb-friendly, own-reaction highlighted.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 3,
    marginHorizontal: 2,
  },
  chipRowMine: { alignSelf: 'flex-end' },
  chipRowTheirs: { alignSelf: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.full,
    paddingHorizontal: 9,
    height: 30,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipMine: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipPressed: { opacity: 0.8 },
  chipEmoji: { fontSize: 13 },
  chipCount: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  chipCountMine: { color: colors.primaryStrong },
  // Pending (§14): failed state exposes Retry clearly.
  bubbleFailed: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  retryBtn: {
    minWidth: TOUCH_TARGET,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  retryText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  // Date separators (§13): quiet, centered, only on day change.
  dateWrap: { alignItems: 'center', marginVertical: 10 },
  datePill: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  typing: {
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: spacing.lg,
    marginVertical: 6,
  },
  earlierLoader: { paddingVertical: spacing.md, alignItems: 'center' },
  earlierText: { color: colors.textMuted, fontSize: 12 },
  emptyChatWrap: { alignItems: 'center', marginTop: 96, paddingHorizontal: 32 },
  emptyChatIcon: { fontSize: 40, marginBottom: 10 },
  emptyChatTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyChatBody: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  errorTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  errorBody: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  errorRetry: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minHeight: TOUCH_TARGET - 4,
    justifyContent: 'center',
  },
  errorRetryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
  skeletonBubble: {
    height: 36,
    borderRadius: radius.bubble,
    marginHorizontal: spacing.md,
    marginVertical: 4,
  },
  skeletonTheirs: {
    backgroundColor: colors.surfaceRaised,
    alignSelf: 'flex-start',
  },
  skeletonMine: { backgroundColor: colors.surface, alignSelf: 'flex-end' },

  // ---- Floating new-message pill (§36) ------------------------------------
  newPill: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
  },
  newPillBtn: {
    backgroundColor: colors.primaryStrong,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  newPillPressed: { opacity: 0.85 },
  newPillText: { color: colors.background, fontSize: 12, fontWeight: '700' },

  // ---- Composer (§19) ------------------------------------------------------
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  bannerAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: colors.primaryStrong,
  },
  bannerBody: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
  bannerLabel: { color: colors.primaryStrong, fontSize: 11, fontWeight: '700' },
  bannerText: { color: colors.textSecondary, fontSize: 13 },
  bannerClose: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCloseText: { color: colors.textSecondary, fontSize: 15 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnPressed: { opacity: 0.8 },
  attachIcon: { color: colors.textPrimary, fontSize: 22, marginTop: -2 },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 22,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 15,
    paddingTop: 11,
    paddingBottom: 11,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnIdle: { backgroundColor: colors.surfaceHigh, opacity: 0.6 },
  sendIcon: { color: colors.onPrimary, fontSize: 17 },

  // ---- Sheets & menus (§17/§18) -------------------------------------------
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: 2,
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  sheetHeading: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    minHeight: 56,
  },
  sheetOptionPressed: { backgroundColor: colors.surfaceHigh },
  sheetIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetIcon: { fontSize: 18 },
  sheetTextWrap: { flex: 1 },
  sheetOptionTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetOptionBody: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  sheetCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs + 2,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 48,
  },
  sheetCancelText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.sm,
  },
  reactionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  reactionBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionBtnPressed: { backgroundColor: colors.surfaceHigh },
  reactionEmoji: { fontSize: 27 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 50,
    borderRadius: radius.md,
  },
  menuItemPressed: { backgroundColor: colors.surfaceHigh },
  menuItemIcon: { fontSize: 17, width: 22, color: colors.textSecondary },
  menuItemText: { color: colors.textPrimary, fontSize: 15 },
  menuItemDanger: { color: colors.danger },
  menuCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    minHeight: 48,
  },

  // ---- Lightbox (§20) ------------------------------------------------------
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 16, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: { width: '100%', height: '80%' },
  lightboxClose: {
    position: 'absolute',
    top: 60,
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCloseText: { color: '#FFFFFF', fontSize: 16 },
});
