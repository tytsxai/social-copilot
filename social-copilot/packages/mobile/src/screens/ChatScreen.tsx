import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView } from 'react-native';
import type { Message, ContactKey, ReplyStyle } from '@social-copilot/core';
import { initLLM, generateReply } from '../adapters/coreClient';
import { getApiKey } from '../env';

// Initialize LLM once; key is provided via env.
initLLM({ apiKey: getApiKey() || 'DEMO_API_KEY', provider: 'deepseek' });

const dummyContactKey: ContactKey = { app: 'other', peerId: 'self', platform: 'web', conversationId: 'demo', isGroup: false };
const defaultStyles: ReplyStyle[] = ['caring', 'humorous', 'casual'];

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const msg: Message = {
      id: Date.now().toString(),
      contactKey: dummyContactKey,
      direction: 'outgoing',
      senderName: '我',
      text: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    setError(null);

    const inputPayload = {
      context: {
        contactKey: dummyContactKey,
        recentMessages: messages.concat(msg),
        currentMessage: msg,
      },
      styles: defaultStyles,
      language: 'zh',
    } as const;

    try {
      const output = await generateReply(inputPayload);
      setSuggestions(output.candidates.map((c) => c.text));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll}>
        {messages.map((m) => (
          <View key={m.id} style={styles.message}>
            <Text style={styles.sender}>{m.senderName}:</Text>
            <Text>{m.text}</Text>
          </View>
        ))}
        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            <Text style={styles.sectionTitle}>建议</Text>
            {suggestions.map((s, idx) => (
              <Text key={idx} style={styles.suggestionItem}>{s}</Text>
            ))}
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="输入消息..."
        />
        <Button title="发送" onPress={handleSend} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  scroll: { flex: 1 },
  message: { marginBottom: 8 },
  sender: { fontWeight: 'bold' },
  suggestions: { marginTop: 12, padding: 8, backgroundColor: '#f5f5f5', borderRadius: 8 },
  suggestionItem: { marginTop: 4 },
  sectionTitle: { fontWeight: 'bold' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  error: { color: 'red', marginTop: 8 },
});
