import React, { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Home, Sparkles, Dumbbell, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../services/supabase";

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

  const hideNavbar = !session || currentRoute === "Onboarding" || currentRoute === "Login" || currentRoute === "Signup" || currentRoute === "PatientProfile" || currentRoute === "Exercise";

  return (
    <View className="flex-1 bg-slate-50">
      {/* Horizontal Navbar (Top) */}
      {!hideNavbar && (
        <View 
          className="flex-row items-center justify-between bg-white px-4 shadow-sm border-b border-slate-200 z-10"
          style={{ paddingTop: Math.max(insets.top, 16), paddingBottom: 16 }}
        >
          {/* Placeholder for balance */}
          <View className="w-10" />
          
          <View className="flex-1 items-center justify-center">
            <Text className="text-2xl font-black tracking-tight text-blue-600">{title}</Text>
          </View>
          
          <Pressable 
            onPress={() => navigationRef?.navigate("PatientProfile")}
            className="p-2 bg-slate-100 rounded-full"
          >
            <User color="#2563eb" size={24} />
          </Pressable>
        </View>
      )}

      {/* Main Content Area */}
      <View className={`flex-1 bg-slate-50 ${!hideNavbar ? "px-4 pt-4" : ""}`}>
        {children}
      </View>

      {/* Footer Bar (Bottom) */}
      {!hideNavbar && (
        <View 
          className="flex-row items-center justify-around bg-white border-t border-slate-200 pt-3 px-2 shadow-lg"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {bottomNavItems.map(({ label, route, icon: Icon }) => {
            const isActive = currentRoute === route;
            const handlePress = () => {
              if (isActive) return;
              // Slide left when going forward in tab order, right when going back.
              const fromIdx = ROUTE_ORDER[currentRoute] ?? 0;
              const toIdx   = ROUTE_ORDER[route]        ?? 0;
              const direction = toIdx > fromIdx ? 'left' : 'right';
              navigationRef?.navigate(route, { direction });
            };
            return (
              <Pressable
                key={label}
                onPress={handlePress}
                className={`items-center justify-center px-6 py-2 rounded-2xl ${isActive ? "bg-blue-600" : "bg-transparent"}`}
              >
                <Icon color={isActive ? "#ffffff" : "#64748b"} size={24} />
                <Text className={`text-xs mt-1 font-bold ${isActive ? "text-white" : "text-slate-500"}`}>
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
