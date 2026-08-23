import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import ForgotPasswordCard from '../components/Auth/ForgotPasswordCard.js';
import { palette } from '../constants/palette';

const ForgotPasswordScreen = ({ navigation }) => {
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: palette.canvas }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 26 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ForgotPasswordCard navigation={navigation} />
      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default ForgotPasswordScreen;
