import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class EndMonitoringDto {
  @ApiProperty({
    description: 'Senha atual do usuário para reautenticação obrigatória antes de encerrar o monitoramento',
    example: 'senha-atual',
    type: String,
  })
  @IsString({ message: 'A senha deve ser uma cadeia de caracteres.' })
  @IsNotEmpty({ message: 'Informe a senha atual para confirmar o encerramento do monitoramento.' })
  @MinLength(1, { message: 'A senha não pode estar em branco.' })
  password!: string;
}
