import React, { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Home, Sparkles, Dumbbell, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../services/supabase";
import { palette } from "../../constants/palette";
import { fonts } from "../../constants/fonts";

// Tab order — lower index is "further left", higher is "further right".
// Used to derive the slide direction when switching tabs.
const ROUTE_ORDER = { Dashboard: 0, Sessions: 1, Exercise: 2 };

const bottomNavItems = [
  { label: "Home",     route: "Dashboard", icon: Home },
  { label: "Sessions", route: "Sessions",  icon: Sparkles },
  { label: "Exercise", route: "Exercise",  icon: Dumbbell },
];

export default function Navbar({ title, currentRoute, children, navigationRef }) {
  const [session, setSession] = useState(null);

  //get user session to check if user is logged in or not 
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    //watches wheter the session changes wheter the user logs out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    //cleanup removes the subscription when the component unmounts
    return () => subscription.unsubscribe();
  }, []);

  const insets = useSafeAreaInsets();

  const hideNavbar = !session || currentRoute === "Onboarding" || currentRoute === "Login" || currentRoute === "Signup" || currentRoute === "PatientProfile" || currentRoute === "Exercise" || currentRoute === "SessionSummary";

  return (
    <View className="flex-1" style={{ backgroundColor: palette.canvas }}>
      {/* Horizontal Navbar (Top) */}
      {!hideNavbar && (
        <View
          className="flex-row items-center justify-between border-b z-10"
          style={{
            backgroundColor: palette.canvas,
            borderColor: palette.line,
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: 16,
            paddingHorizontal: 16,
          }}
        >
          {/* Placeholder for balance */}
          <View className="w-10" />

          <View className="flex-1 items-center justify-center">
            <Text style={{ color: palette.ink, fontFamily: fonts.serif, fontSize: 20 }}>{title}</Text>
          </View>

          <Pressable
            onPress={() => navigationRef?.navigate("PatientProfile")}
            className="p-2 rounded-full"
            style={{ backgroundColor: palette.primarySoft }}
          >
            <User color={palette.primary} size={24} />
          </Pressable>
        </View>
      )}

      {/* Main Content Area */}
      <View className={`flex-1 ${!hideNavbar ? "px-4 pt-4" : ""}`} style={{ backgroundColor: palette.canvas }}>
        {children}
      </View>

      {/* Footer Bar (Bottom) */}
      {!hideNavbar && (
        <View
          className="flex-row items-center justify-around border-t pt-3 px-2"
          style={{ backgroundColor: palette.card, borderColor: palette.line, paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {bottomNavItems.map(({ label, route, icon: Icon }) => {
            const isActive = currentRoute === route;
            const handlePress = () => {
              if (isActive) return;
              // Slide left when going forward in tab order, right when going back.
              const fromIdx = ROUTE_ORDER[currentRoute] ?? 0;
              const toIdx   = ROUTE_ORDER[route]        ?? 0;
              const direction = toIdx > fromIdx ? 'left' : 'right';
              // pop: true - if `route` is already deeper in the stack, pop back to
              // it (unmounting whatever's above) instead of pushing a new instance
              // on top every tap, which piled up unbounded mounted screens.
              navigationRef?.navigate(route, { direction }, { pop: true });
            };
            return (
              <Pressable
                key={label}
                onPress={handlePress}
                className="items-center justify-center px-6 py-2 rounded-2xl"
                style={{ backgroundColor: isActive ? palette.primary : 'transparent' }}
              >
                <Icon color={isActive ? "#ffffff" : palette.inkSoft} size={24} />
                <Text
                  className="text-xs mt-1"
                  style={{ color: isActive ? "#ffffff" : palette.inkSoft, fontFamily: fonts.sansBold }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
