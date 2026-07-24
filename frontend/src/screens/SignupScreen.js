import { View, Text, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import SignupCard from '../components/Auth/SignupCard.js';

const SignupScreen = ({ navigation }) => {
  return (
    <SafeAreaProvider className="flex-1 bg-[#FAFAFA]">
      <KeyboardAwareScrollView 
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
          
          <View className="items-center mb-10 mt-10">
            <Text className="text-5xl font-bold text-gray-900 mb-4">TheraMotion</Text>
            <Text className="text-[32px] font-bold text-[#0052CC] mb-2 text-center">
              Create Account
            </Text>
            <Text className="text-[20px] text-[#434654] text-center">
              Start your recovery journey today
            </Text>
          </View>

          <SignupCard navigation={navigation} />

      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default SignupScreen;
