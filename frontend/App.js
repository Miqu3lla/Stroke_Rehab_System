import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {  Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import Navbar from './src/components/ui/navbar';
import "./global.css"

export default function App() {
  const navigationRef = useNavigationContainerRef();
  const [currentRoute, setCurrentRoute] = useState("Dashboard");

  return (
    //AppNavigator is wrapped in NavigationContainer to manage navigation state and linkingr
    <SafeAreaProvider>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          setCurrentRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard");
        }}
        onStateChange={() => {
          setCurrentRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard");
        }}
      >
        <Navbar title="TheraMotion" currentRoute={currentRoute}>
          <AppNavigator />
        </Navbar>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}




