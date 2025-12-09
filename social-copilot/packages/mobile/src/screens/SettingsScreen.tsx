import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SettingsScreen = () => (
  <View style={styles.container}>
    <Text style={styles.title}>设置</Text>
    <Text style={styles.subtitle}>更多设置即将推出</Text>
  </View>
);

export default memo(SettingsScreen);

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: 'bold' },
  subtitle: { marginTop: 8, color: '#666' },
});
