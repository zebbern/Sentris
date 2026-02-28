export interface FormState {
  name: string;
  description: string;
  tags: string;
  value: string;
}

export type EditFormState = Pick<FormState, 'name' | 'description' | 'tags' | 'value'>;

export const INITIAL_FORM: FormState = {
  name: '',
  description: '',
  tags: '',
  value: '',
};

export const INITIAL_EDIT_FORM: EditFormState = {
  name: '',
  description: '',
  tags: '',
  value: '',
};

export const SECRET_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const SECRET_NAME_MAX_LENGTH = 128;
