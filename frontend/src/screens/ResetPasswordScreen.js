import { View, Text, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import ResetPasswordCard from '../components/Auth/ResetPasswordCard.js';

const ResetPasswordScreen = ({ navigation, route }) => {
  const email = route?.params?.email ?? '';

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
              Reset Password
            </Text>
            <Text className="text-[20px] text-[#434654] text-center">
              Enter the code sent to {email}
            </Text>
          </View>

          <ResetPasswordCard email={email} navigation={navigation} />

      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default ResetPasswordScreen;
