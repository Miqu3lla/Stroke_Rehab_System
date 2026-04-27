import { StatusBar } from 'expo-status-bar';
import {  Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation';
import { NavigationContainer } from '@react-navigation/native';
import Navbar from './src/components/ui/navbar';
import "./global.css"

export default function App() {
  return (
    //AppNavigator is wrapped in NavigationContainer to manage navigation state and linkingr
    <SafeAreaProvider>
      <NavigationContainer>
        <Navbar title="Stroke Rehab Home">
          <AppNavigator />
        </Navbar>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}




