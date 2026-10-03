import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class PauseMonitoringDto {
  @ApiProperty({
    description: 'Senha atual do usuário para reautenticação obrigatória antes da pausa',
    example: 'senha-atual',
    type: String,
  })
  @IsString({ message: 'A senha deve ser uma cadeia de caracteres.' })
  @IsNotEmpty({ message: 'Informe a senha atual para confirmar a pausa do monitoramento.' })
  @MinLength(1, { message: 'A senha não pode estar em branco.' })
  password!: string;
}
