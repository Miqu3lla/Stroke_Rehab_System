import { useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import Navbar from './src/components/ui/navbar';
import "./global.css"
import { supabase } from './src/services/supabase';
import useAuthStore from './src/store/useAuthStore';
import { queryClient } from './src/lib/queryClient';

export default function App() {
  const navigationRef = useNavigationContainerRef();
  const [currentRoute, setCurrentRoute] = useState("Dashboard");

  const user = useAuthStore((state) => state.user)
//useEffect to track the user status when active 
  useEffect(() => {
    if (!user) return 
    //creates a channel
    const presenceChannel = supabase.channel('tracking')

    let appStateSubscription;

    //Subscribes to presence events in the channel
    presenceChannel.subscribe(async(status) => {
      console.log("Websocket Status: ", status)
      //if the user exists
      if (status == 'SUBSCRIBED') {
        try {
          await presenceChannel.track({
            patient_id: user.id,
            status: "Active",
            updated_at: new Date().toISOString()
          })
        } catch (error) {
          console.error("Error tracking presence:", error)
        }
        
        //checks for when the user comes back to the app via eventListener on change
        appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
          if (nextAppState === 'background' || nextAppState === 'inactive') {
            try {
              await presenceChannel.untrack()
              console.log('tracking ended for user:', user.id)
            } catch (error) {
              console.error("Error untracking presence:", error)
            }
          } else if (nextAppState === 'active') {
            try {
              await presenceChannel.track({
                patient_id: user.id,
                status: "Active",
                updated_at: new Date().toISOString()
              })
            } catch (error) {
              console.error("Error tracking presence on app active:", error)
            }
          }
        })
      }
    })


    //cleanup when user logs out or app closes
    return () => {
      if (appStateSubscription) {
        appStateSubscription.remove();
      }
      supabase.removeChannel(presenceChannel)
    }
  }, [user])


  return (
    //AppNavigator is wrapped in NavigationContainer to manage navigation state and linking
    <QueryClientProvider client={queryClient}>
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

          <Navbar title="TheraMotion" currentRoute={currentRoute} navigationRef={navigationRef}>
            <AppNavigator />
          </Navbar>
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}




