import { useState, useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
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

  // Gates the whole tree the same way the auth check does below — avoids
  // a flash of system-font text before the redesign's Fraunces/Public
  // Sans/IBM Plex Mono trio is ready.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  // Don't hang on a blank screen forever if a font asset fails to load —
  // fall through to system fonts rather than blocking the whole app.
  if (fontError) {
    console.error('Font load failed, continuing with system fonts:', fontError);
  }

  const user = useAuthStore((state) => state.user)
  // Key off the id, not the object - session.user is a fresh reference on
  // every getAuthSession() call, so keying on `user` itself was tearing down
  // and reopening this channel on every screen remount, not just real login changes.
  const userId = user?.id
//useEffect to track the user status when active
  useEffect(() => {
    if (!userId) return
    //creates a channel
    const presenceChannel = supabase.channel('tracking')

    let appStateSubscription;
    // Subscribe's callback resolves async - if cleanup already ran by then
    // (e.g. another rapid nav), skip so we don't register a listener nothing will ever remove.
    let cancelled = false;

    //Subscribes to presence events in the channel
    presenceChannel.subscribe(async(status) => {
      console.log("Websocket Status: ", status)
      //if the user exists
      if (status == 'SUBSCRIBED' && !cancelled) {
        try {
          await presenceChannel.track({
            patient_id: userId,
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
              console.log('tracking ended for user:', userId)
            } catch (error) {
              console.error("Error untracking presence:", error)
            }
          } else if (nextAppState === 'active') {
            try {
              await presenceChannel.track({
                patient_id: userId,
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
      cancelled = true;
      if (appStateSubscription) {
        appStateSubscription.remove();
      }
      supabase.removeChannel(presenceChannel)
    }
  }, [userId])

  // Same pattern as AppNavigator's user===null guard — render nothing
  // until the redesign's fonts are ready rather than flashing fallback text.
  // Proceeds on fontError too (see above) so a failed font load degrades
  // to system fonts instead of blocking the app forever.
  if (!fontsLoaded && !fontError) {
    return null;
  }

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




