// Icon fonts, stubbed for the test runner.
//
// @expo/vector-icons ships extensionless internal imports that vite
// cannot resolve, and its real job — loading a font and drawing a glyph —
// is neither something jsdom can do nor something a render test should
// assert. The icon's name is kept as a data attribute so a test can check
// which icon was chosen where that is the point; everything else is a
// hole where a glyph goes.
function stub(family: string) {
  return function Icon({ name }: { name?: string; size?: number; color?: string }) {
    return <span data-icon={`${family}:${name ?? ''}`} aria-hidden="true" />;
  };
}

export const Ionicons = stub('ionicons');
export const MaterialCommunityIcons = stub('mci');
export const MaterialIcons = stub('material');
export const FontAwesome = stub('fa');
export const FontAwesome5 = stub('fa5');
export const AntDesign = stub('antd');
export const Feather = stub('feather');
export const Entypo = stub('entypo');
