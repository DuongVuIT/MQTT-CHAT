import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { avatarColorHex } from "@mqtt-chat/realtime-core";
import { ProfileSheet } from "@app/components/ProfileSheet";
import type { ApiConversation } from "@app/lib/api";
import { ConversationListScreen } from "@app/screens/ConversationListScreen";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const directConversation: ApiConversation = {
  id: "dm-bob-duong",
  type: "DIRECT",
  title: null,
  lastSequence: 0,
  lastMessagePreview: null,
  lastMessageAt: null,
  members: [
    { userId: "duong", role: "MEMBER", lastReadSequence: 0 },
    { userId: "bob", role: "MEMBER", lastReadSequence: 0 },
  ],
};

function renderAs(identityUserId: "duong" | "bob") {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ConversationListScreen
        conversations={[directConversation]}
        presence={{}}
        status="connected"
        users={[
          { id: "duong", displayName: "Dương", avatarUrl: null },
          { id: "bob", displayName: "Bob", avatarUrl: null },
        ]}
        identityUserId={identityUserId}
        identityDisplayName={identityUserId === "duong" ? "Dương" : "Bob"}
        onOpen={() => {}}
        onNew={() => {}}
        onProfile={() => {}}
      />,
    );
  });
  return tree;
}

describe("ConversationListScreen avatar identity", () => {
  it.each([
    ["duong", "bob", "B"],
    ["bob", "duong", "D"],
  ] as const)(
    "%s sees the canonical %s avatar in the DIRECT row",
    (identityUserId, peerUserId, expectedInitials) => {
      const tree = renderAs(identityUserId);
      const avatar = tree.root.findByProps({
        testID: `conversation-avatar-${directConversation.id}`,
      });
      const label = avatar.findByType(Text);
      expect(label.props.children).toBe(expectedInitials);
      expect(StyleSheet.flatten(avatar.props.style).backgroundColor).toBe(
        avatarColorHex(peerUserId),
      );
      expect(StyleSheet.flatten(label.props.style).color).toBe("#FFFFFF");

      act(() => tree.unmount());
    },
  );

  it("renders Dương identically in the list header and profile sheet", () => {
    const list = renderAs("duong");
    const headerAvatar = list.root.findByProps({ testID: "profile-avatar" });
    const headerLabel = headerAvatar.findByType(Text);

    let sheet!: TestRenderer.ReactTestRenderer;
    act(() => {
      sheet = TestRenderer.create(
        <ProfileSheet
          visible
          displayName="Dương"
          userId="duong"
          deviceId="mobile-test"
          status="connected"
          onClose={() => {}}
          onSwitch={() => {}}
        />,
      );
    });
    const sheetAvatar = sheet.root.findByProps({
      testID: "profile-sheet-avatar",
    });
    const sheetLabel = sheetAvatar.findByType(Text);

    expect({
      initials: headerLabel.props.children,
      backgroundColor: StyleSheet.flatten(headerAvatar.props.style({ pressed: false }))
        .backgroundColor,
      foregroundColor: StyleSheet.flatten(headerLabel.props.style).color,
    }).toEqual({
      initials: sheetLabel.props.children,
      backgroundColor: StyleSheet.flatten(sheetAvatar.props.style).backgroundColor,
      foregroundColor: StyleSheet.flatten(sheetLabel.props.style).color,
    });

    act(() => list.unmount());
    act(() => sheet.unmount());
  });
});
