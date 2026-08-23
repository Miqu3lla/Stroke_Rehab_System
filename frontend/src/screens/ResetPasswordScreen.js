import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import ResetPasswordCard from '../components/Auth/ResetPasswordCard.js';
import { palette } from '../constants/palette';

const ResetPasswordScreen = ({ navigation, route }) => {
  const email = route?.params?.email ?? '';

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: palette.canvas }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 26 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ResetPasswordCard email={email} navigation={navigation} />
      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default ResetPasswordScreen;
