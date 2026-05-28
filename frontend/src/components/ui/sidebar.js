import React from "react";
import { Pressable, Text, View, StyleSheet, Dimensions, Animated } from "react-native";
import { Home, Settings, Sparkles, UserRound, X, Activity, LogOut } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
//sideBar items
const sidebarItems = [
  { label: "Dashboard", route: "Dashboard", icon: Home },
  { label: "Sessions", route: "Sessions", icon: Sparkles },
  { label: "Exercise", route: "Exercise", icon: Activity },
];

export default function Sidebar({ isOpen, onClose, currentRoute }) {
  
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} className="z-50 flex-row">
      <Pressable className="flex-1 bg-black/50 z-40" onPress={onClose} />
      <View 
        className="absolute left-0 top-0 bottom-0 w-64 bg-white px-4 z-50 shadow-2xl border-r border-slate-200"
        style={{ paddingTop: Math.max(insets.top, 32), paddingBottom: Math.max(insets.bottom, 32) }}
      >
        <View className="flex-row items-center justify-between mb-8">
          <Text className="text-xl font-bold text-slate-900">Menu</Text>
          <Pressable onPress={onClose} className="p-2 bg-slate-100 rounded-full">
            <X color="#0f172a" size={20} />
          </Pressable>
        </View>

        {sidebarItems.map(({ label, route, icon: Icon }) => {
          //makes the currentroute matches the one on the sidebarItems routes
          const isActive = currentRoute === route;
          return (
          <Pressable
            key={label}
            onPress={() => {
              // Note: Make sure the route exists in your navigator before navigating.
              try { navigation.navigate(route); } catch (e) {}
              onClose();
            }}
            className={`flex-row items-center mb-4 rounded-xl px-4 py-3 ${
              isActive ? "bg-blue-600" : "bg-transparent"
            }`}
          >
            <View className={`h-8 w-8 items-center justify-center rounded-lg mr-4 ${isActive ? "bg-blue-500" : "bg-slate-100"}`}>
              <Icon color={isActive ? "#ffffff" : "#475569"} size={18} />
            </View>
            <Text className={`text-sm font-medium ${isActive ? "text-white" : "text-slate-700"}`}>{label}</Text>
          </Pressable>
        )})}
      </View>
    </View>
  );
}