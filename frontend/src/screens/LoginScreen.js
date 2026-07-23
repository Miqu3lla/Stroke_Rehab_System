import { View, Text, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import LoginCard from '../components/Auth/LoginCard.js';

const LoginScreen = ({ navigation }) => {
  return (
    <SafeAreaProvider className="flex-1 bg-[#FAFAFA]">
      <KeyboardAwareScrollView 
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          
          <View className="items-center mb-10">
            <Text className="text-5xl font-bold text-gray-900 mb-4">TheraMotion</Text>
            <Text className="text-[32px] font-bold text-[#0052CC] mb-2 text-center">
              Welcome Back
            </Text>
            <Text className="text-[20px] text-[#434654] text-center">
              Sign in to continue your recovery
            </Text>
          </View>

          <LoginCard navigation={navigation} />

      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default LoginScreen;
