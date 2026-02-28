import {
  type ComponentCategory,
  DEFAULT_COMPONENT_CATEGORY,
  getComponentCategoryDescriptor,
  normalizeComponentCategory,
} from '@shipsec/shared';

function resolveCategory(category: string): ComponentCategory {
  return normalizeComponentCategory(category) ?? DEFAULT_COMPONENT_CATEGORY;
}

export function getCategoryTextColorClass(category: string): string {
  return getComponentCategoryDescriptor(resolveCategory(category)).textColorClass;
}

export function getCategorySeparatorColor(category: string, isDarkMode: boolean): string {
  const colors = getComponentCategoryDescriptor(resolveCategory(category)).separatorColor;
  return isDarkMode ? colors.dark : colors.light;
}

export function getCategoryHeaderBackgroundColor(category: string, isDarkMode: boolean): string {
  const colors = getComponentCategoryDescriptor(resolveCategory(category)).headerBackgroundColor;
  return isDarkMode ? colors.dark : colors.light;
}
