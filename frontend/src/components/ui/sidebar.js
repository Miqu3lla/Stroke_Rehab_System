import React from "react";
import { Pressable, Text, View, StyleSheet, Dimensions, Animated } from "react-native";
import { Home, Settings, Sparkles, UserRound, X, Activity } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const sidebarItems = [
  { label: "Dashboard", icon: Home },
  { label: "Sessions", icon: Sparkles },
  { label: "Patients", icon: UserRound },
  { label: "Exercise", icon: Activity },
  { label: "Settings", icon: Settings },
];

const Sidebar = ({ isOpen, onClose }) => {
  const insets = useSafeAreaInsets();

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

        {sidebarItems.map(({ label, icon: Icon }, index) => (
          <Pressable
            key={label}
            className={`flex-row items-center mb-4 rounded-xl px-4 py-3 ${
              index === 0 ? "bg-slate-800" : "bg-transparent"
            }`}
          >
            <View className="h-8 w-8 items-center justify-center rounded-lg bg-slate-900 mr-4">
              <Icon color="#e2e8f0" size={18} />
            </View>
            <Text className="text-sm font-medium text-slate-200">{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

export default Sidebar;