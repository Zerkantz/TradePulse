import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0A0E14" translucent={false} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0E14' } }} />
    </SafeAreaProvider>
  );
}
