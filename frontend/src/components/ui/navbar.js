import React, { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Menu, User } from "lucide-react-native";
import Sidebar from "./sidebar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../services/supabase";

export default function Navbar({ title, currentRoute, children, navigationRef }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

  const hideNavbar = !session || currentRoute === "Onboarding" || currentRoute === "Login" || currentRoute === "Signup" || currentRoute === "PatientProfile";

  return (
    <View className="flex-1 bg-white">
      {/* Horizontal Navbar */}
      {!hideNavbar && (
        <View 
          className="flex-row items-center justify-between bg-white px-4 shadow-sm border-b border-slate-200"
          style={{ paddingTop: Math.max(insets.top, 16), paddingBottom: 16 }}
        >
          <Pressable 
            onPress={() => setIsSidebarOpen(true)}
            className="p-2 bg-slate-100 rounded-lg"
          >
            <Menu color="#2563eb" size={24} />
          </Pressable>
          
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
      <View className={`flex-1 bg-white ${!hideNavbar ? "p-4" : ""}`}>
        {children}
      </View>

      {/* Sidebar Overlay */}
      {!hideNavbar && (
        <Sidebar 
          isOpen={isSidebarOpen} 
          onClose={() => setIsSidebarOpen(false)} 
          currentRoute={currentRoute} 
        />
      )}
    </View>
  );
}
