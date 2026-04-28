import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Menu } from "lucide-react-native";
import Sidebar from "./sidebar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const Navbar = ({ title, currentRoute, children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-slate-100">
      {/* Horizontal Navbar */}
      <View 
        className="flex-row items-center bg-white px-4 shadow-sm border-b border-slate-200"
        style={{ paddingTop: Math.max(insets.top, 16), paddingBottom: 16 }}
      >
        <Pressable 
          onPress={() => setIsSidebarOpen(true)}
          className="p-2 mr-3 bg-slate-100 rounded-lg"
        >
          <Menu color="#0f172a" size={24} />
        </Pressable>
        <View>
          <Text className="text-xl font-bold text-slate-900">{title}</Text>
        </View>
      </View>

      {/* Main Content Area */}
      <View className="flex-1 bg-white p-4">
        {children}
      </View>

      {/* Sidebar Overlay */}
r      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        currentRoute={currentRoute} 
      />
    </View>
  );
};

export default Navbar;
