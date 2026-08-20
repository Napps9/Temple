// Icon fonts, stubbed for the test runner.
//
// @expo/vector-icons ships extensionless internal imports that vite
// cannot resolve, and its real job — loading a font and drawing a glyph —
// is neither something jsdom can do nor something a render test should
// assert. The icon's name is kept as a data attribute so a test can check
// which icon was chosen where that is the point; everything else is a
// hole where a glyph goes.
//
// The tint is kept too. A design system whose central rule is about where
// colour is allowed needs some way to ask what colour something was given,
// and an icon is often the only element in a component carrying a runtime
// colour rather than a class.
function stub(family: string) {
  return function Icon({
    name,
    color,
  }: {
    name?: string;
    size?: number;
    color?: string;
  }) {
    return (
      <span
        data-icon={`${family}:${name ?? ''}`}
        data-color={color ?? ''}
        aria-hidden="true"
      />
    );
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
