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
    //AppNavigator is wrapped in NavigationContainer to manage navigation state and linking
    <SafeAreaProvider>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          //gets current route when navigation is ready
          setCurrentRoute(navigationRef.getCurrentRoute()?.name ?? "Dashboard");
        }}
        onStateChange={() => {
          //gets current route when navigation state changes
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




