import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Home, Settings, Sparkles, UserRound } from "lucide-react-native";

const sidebarItems = [
  { label: "Dashboard", icon: Home },
  { label: "Sessions", icon: Sparkles },
  { label: "Patients", icon: UserRound },
  { label: "Settings", icon: Settings },
];

const Navbar = ({ title, subtitle, children }) => {
  return (
    <View className="flex-1 bg-slate-100">
      <Navbar />

      <View className="flex-1 flex-row">
        <View className="w-28 border-r border-slate-200 bg-slate-950 px-3 py-5">
          {sidebarItems.map(({ label, icon: Icon }, index) => (
            <Pressable
              key={label}
              className={`mb-3 items-center rounded-2xl px-2 py-3 ${
                index === 0 ? "bg-slate-800" : "bg-transparent"
              }`}
            >
              <View className="mb-2 h-10 w-10 items-center justify-center rounded-2xl bg-slate-900">
                <Icon color="#e2e8f0" size={18} />
              </View>
              <Text className="text-center text-xs font-medium text-slate-200">{label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
          <View className="rounded-3xl bg-white p-5 shadow-sm">
            <Text className="text-2xl font-semibold text-slate-900">{title}</Text>
            {subtitle ? (
              <Text className="mt-2 text-sm leading-5 text-slate-600">{subtitle}</Text>
            ) : null}
          </View>

          <View className="mt-5">{children}</View>
        </ScrollView>
      </View>
    </View>
  );
};

export default NavBar;
