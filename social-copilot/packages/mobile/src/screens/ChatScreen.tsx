import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView, Pressable } from 'react-native';
import type { Message, ContactKey, ReplyStyle } from '@social-copilot/core';
import { initLLM, generateReply } from '../adapters/coreClient';
import { getApiKey, getModel, getProvider } from '../env';

const dummyContactKey: ContactKey = { app: 'other', peerId: 'self', platform: 'web', conversationId: 'demo', isGroup: false };
const defaultStyles: ReplyStyle[] = ['caring', 'humorous', 'casual'];

export default function ChatScreen() {
  const apiKeyRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [llmReady, setLlmReady] = useState(false);
  const initOnce = useRef(false);
  const [provider, setProvider] = useState<'deepseek' | 'openai' | 'claude'>('deepseek');
  const [model, setModel] = useState('');

  useEffect(() => {
    if (initOnce.current) return;
    initOnce.current = true;
    const apiKey = getApiKey()?.trim();
    if (!apiKey) {
      setError('未配置 LLM API Key，请在环境变量 EXPO_PUBLIC_LLM_API_KEY 中设置');
      return;
    }
    try {
      apiKeyRef.current = apiKey;
      const initialProvider = getProvider() ?? 'deepseek';
      const initialModel = getModel() ?? '';
      setProvider(initialProvider);
      setModel(initialModel);
      initLLM({ apiKey, provider: initialProvider, model: initialModel.trim() || undefined });
      setLlmReady(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const handleApplyConfig = () => {
    const apiKey = apiKeyRef.current;
    if (!apiKey) {
      setError('未配置 LLM API Key，请在环境变量 EXPO_PUBLIC_LLM_API_KEY 中设置');
      setLlmReady(false);
      return;
    }
    try {
      initLLM({ apiKey, provider, model: model.trim() || undefined });
      setError(null);
      setLlmReady(true);
    } catch (err) {
      setError((err as Error).message);
      setLlmReady(false);
    }
  };

  const handleSend = async () => {
    if (!llmReady) {
      setError('LLM 未初始化，请检查 API Key 配置');
      return;
    }
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
      <View style={styles.configBox}>
        <Text style={styles.sectionTitle}>模型配置</Text>
        <View style={styles.providerRow}>
          <Text style={styles.label}>Provider</Text>
          <View style={styles.providerChips}>
            {(['deepseek', 'openai', 'claude'] as const).map((p) => (
              <Pressable
                key={p}
                onPress={() => setProvider(p)}
                style={[styles.chip, provider === p && styles.chipActive]}
              >
                <Text style={[styles.chipText, provider === p && styles.chipTextActive]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.modelRow}>
          <Text style={styles.label}>Model</Text>
          <TextInput
            style={styles.modelInput}
            value={model}
            onChangeText={setModel}
            placeholder="可选：如 gpt-4o-mini / deepseek-chat"
          />
          <Button title="应用" onPress={handleApplyConfig} />
        </View>
      </View>
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
  configBox: { marginBottom: 12, padding: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 12, backgroundColor: '#fafafa' },
  scroll: { flex: 1 },
  message: { marginBottom: 8 },
  sender: { fontWeight: 'bold' },
  suggestions: { marginTop: 12, padding: 8, backgroundColor: '#f5f5f5', borderRadius: 8 },
  suggestionItem: { marginTop: 4 },
  sectionTitle: { fontWeight: 'bold' },
  label: { width: 70, fontWeight: '600' },
  providerRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center' },
  providerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  chipActive: { borderColor: '#111', backgroundColor: '#111' },
  chipText: { color: '#111' },
  chipTextActive: { color: '#fff' },
  modelRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fff' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  error: { color: 'red', marginTop: 8 },
});
