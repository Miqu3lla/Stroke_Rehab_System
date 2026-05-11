import React from "react";
import { Pressable, Text, View, StyleSheet, Dimensions, Animated } from "react-native";
import { Home, Settings, Sparkles, UserRound, X, Activity, LogOut } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import useAuthStore from "../../store/useAuthStore";

//sideBar items
const sidebarItems = [
  { label: "Dashboard", route: "Dashboard", icon: Home },
  { label: "Sessions", route: "Sessions", icon: Sparkles },
  { label: "Patients", route: "Patients", icon: UserRound },
  { label: "Exercise", route: "Exercise", icon: Activity },
  { label: "Settings", route: "Settings", icon: Settings },
];

const Sidebar = ({ isOpen, onClose, currentRoute }) => {
  
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { logout } = useAuthStore();

  const handleLogout = async () => {
    onClose();
    await logout(navigation);
  };

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} className="z-50 flex-row">
      <Pressable className="flex-1 bg-black/50 z-40" onPress={onClose} />
      <View 
        className="absolute left-0 top-0 bottom-0 w-64 bg-slate-950 px-4 z-50 shadow-xl"
        style={{ paddingTop: Math.max(insets.top, 32), paddingBottom: Math.max(insets.bottom, 32) }}
      >
        <View className="flex-row items-center justify-between mb-8">
          <Text className="text-xl font-bold text-white">Menu</Text>
          <Pressable onPress={onClose} className="p-2 bg-slate-800 rounded-full">
            <X color="#e2e8f0" size={20} />
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
              isActive ? "bg-slate-800" : "bg-transparent"
            }`}
          >
            <View className={`h-8 w-8 items-center justify-center rounded-lg mr-4 ${isActive ? "bg-slate-700" : "bg-slate-900"}`}>
              <Icon color={isActive ? "#ffffff" : "#e2e8f0"} size={18} />
            </View>
            <Text className={`text-sm font-medium ${isActive ? "text-white" : "text-slate-200"}`}>{label}</Text>
          </Pressable>
        )})}

        {/* Logout Button */}
        <View className="border-t border-slate-800 mt-8 pt-4">
          <Pressable
            onPress={handleLogout}
            className="flex-row items-center rounded-xl px-4 py-3 bg-red-900/20 hover:bg-red-900/30"
          >
            <View className="h-8 w-8 items-center justify-center rounded-lg mr-4 bg-red-900/40">
              <LogOut color="#fca5a5" size={18} />
            </View>
            <Text className="text-sm font-medium text-red-300">Logout</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default Sidebar;