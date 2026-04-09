export interface StakingConfig {
  groupIndex: number
  alphUnstakeVaultTemplateId: string
  xAlphTokenId: string
  xAlphTokenAddress: string
  xAlphStakeVaultId: string
  xAlphStakeVaultAddress: string
  rewardSharingTemplateId?: string
  governanceDemoTemplateId?: string
}

export interface StakeVaultUserInfo {
  amount: bigint
  connectedDapps: string[]
}
