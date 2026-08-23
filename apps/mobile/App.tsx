import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRoot } from './src/app/AppRoot';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppRoot />
    </SafeAreaProvider>
  );
}
